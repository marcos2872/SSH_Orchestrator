use anyhow::{anyhow, Result};
use dashmap::DashMap;
use russh::{
    client::{self, Handle},
    keys::PublicKey,
};
use russh_sftp::client::SftpSession;
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::services::ssh::SshClientHandler;

// ─── Public types ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct SftpEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<u64>,
}

#[derive(Debug, Serialize, Clone)]
pub struct ProgressEvent {
    pub session_id: String,
    pub file: String,
    pub bytes_done: u64,
    pub bytes_total: u64,
}

#[derive(Debug, Serialize)]
pub struct LocalEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

// ─── Session state ────────────────────────────────────────────────────────────

struct SftpState {
    session: SftpSession,
}

// ─── Service ─────────────────────────────────────────────────────────────────

pub struct SftpService {
    sessions: DashMap<String, SftpState>,
}

impl SftpService {
    pub fn new() -> Self {
        Self { sessions: DashMap::new() }
    }

    /// Open an SFTP channel over an existing SSH Handle (stored as Arc<Mutex<Handle>>).
    pub async fn open_session(
        &self,
        handle: Arc<Mutex<Handle<SshClientHandler>>>,
    ) -> Result<String> {
        let channel = handle.lock().await.channel_open_session().await?;
        let session = SftpSession::new(channel.into_stream()).await?;
        let id = Uuid::new_v4().to_string();
        self.sessions.insert(id.clone(), SftpState { session });
        Ok(id)
    }

    /// Create a direct SSH + SFTP connection (no PTY/shell) for the dual-pane file manager.
    /// Returns the SFTP session ID.
    pub async fn open_direct(
        &self,
        host: &str,
        port: u16,
        username: &str,
        password: &str,
    ) -> Result<String> {
        let config = Arc::new(client::Config::default());
        let mut handle = client::connect(config, (host, port), SshClientHandler).await?;
        let auth = handle.authenticate_password(username, password).await?;
        if !matches!(auth, russh::client::AuthResult::Success) {
            return Err(anyhow!("Autenticação SSH falhou"));
        }
        let channel = handle.channel_open_session().await?;
        let session = SftpSession::new(channel.into_stream()).await?;
        let id = Uuid::new_v4().to_string();
        self.sessions.insert(id.clone(), SftpState { session });
        Ok(id)
    }

    /// List local filesystem directory.
    pub fn list_local(&self, path: &str) -> Result<Vec<LocalEntry>> {
        let dir = std::path::Path::new(path);
        let mut entries = Vec::new();
        for entry in std::fs::read_dir(dir)? {
            let e = entry?;
            let meta = e.metadata()?;
            let name = e.file_name().to_string_lossy().to_string();
            let full_path = e.path().to_string_lossy().to_string();
            // Skip hidden files
            if name.starts_with('.') { continue; }
            entries.push(LocalEntry {
                is_dir: meta.is_dir(),
                size: if meta.is_file() { meta.len() } else { 0 },
                path: full_path,
                name,
            });
        }
        entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
        Ok(entries)
    }

    /// List directory contents.
    pub async fn list_dir(&self, session_id: &str, path: &str) -> Result<Vec<SftpEntry>> {
        let guard = self.sessions.get(session_id)
            .ok_or_else(|| anyhow!("Sessão SFTP não encontrada: {}", session_id))?;

        let entries = guard.session.read_dir(path).await?;

        let result = entries
            .map(|e| {
                let meta = e.metadata();
                SftpEntry {
                    is_dir: e.file_type().is_dir(),
                    size: meta.size.unwrap_or(0),
                    modified: meta.mtime.map(|t| t as u64),
                    path: format!("{}/{}", path.trim_end_matches('/'), e.file_name()),
                    name: e.file_name(),
                }
            })
            .collect();
        Ok(result)
    }

    /// Upload a local file to a remote path, emitting progress events.
    /// Uses session.write() to upload the file in one call after reading it
    /// locally, then emits a single completion progress event.
    pub async fn upload(
        &self,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
        app: &AppHandle,
    ) -> Result<()> {
        let bytes = tokio::fs::read(local_path).await?;
        let total = bytes.len() as u64;
        let file_name = std::path::Path::new(local_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| remote_path.to_string());

        let guard = self.sessions.get(session_id)
            .ok_or_else(|| anyhow!("Sessão SFTP não encontrada: {}", session_id))?;

        guard.session.write(remote_path, &bytes).await?;

        let _ = app.emit(&format!("sftp://progress/{}", session_id), ProgressEvent {
            session_id: session_id.to_string(),
            file: file_name,
            bytes_done: total,
            bytes_total: total,
        });

        Ok(())
    }

    /// Download a remote file to a local path, emitting a completion event.
    pub async fn download(
        &self,
        session_id: &str,
        remote_path: &str,
        local_path: &str,
        app: &AppHandle,
    ) -> Result<()> {
        let file_name = remote_path.split('/').last()
            .unwrap_or(remote_path).to_string();

        let guard = self.sessions.get(session_id)
            .ok_or_else(|| anyhow!("Sessão SFTP não encontrada: {}", session_id))?;

        let bytes = guard.session.read(remote_path).await?;
        let total = bytes.len() as u64;
        drop(guard);

        tokio::fs::write(local_path, &bytes).await?;

        let _ = app.emit(&format!("sftp://progress/{}", session_id), ProgressEvent {
            session_id: session_id.to_string(),
            file: file_name,
            bytes_done: total,
            bytes_total: total,
        });

        Ok(())
    }

    /// Delete a file or directory.
    pub async fn delete(&self, session_id: &str, path: &str) -> Result<()> {
        let guard = self.sessions.get(session_id)
            .ok_or_else(|| anyhow!("Sessão SFTP não encontrada: {}", session_id))?;
        if guard.session.remove_file(path).await.is_err() {
            guard.session.remove_dir(path).await?;
        }
        Ok(())
    }

    /// Rename / move a path.
    pub async fn rename(&self, session_id: &str, from: &str, to: &str) -> Result<()> {
        let guard = self.sessions.get(session_id)
            .ok_or_else(|| anyhow!("Sessão SFTP não encontrada: {}", session_id))?;
        guard.session.rename(from, to).await?;
        Ok(())
    }

    /// Create a remote directory.
    pub async fn mkdir(&self, session_id: &str, path: &str) -> Result<()> {
        let guard = self.sessions.get(session_id)
            .ok_or_else(|| anyhow!("Sessão SFTP não encontrada: {}", session_id))?;
        guard.session.create_dir(path).await?;
        Ok(())
    }

    /// Close and remove the SFTP session.
    pub async fn close_session(&self, session_id: &str) -> Result<()> {
        if let Some((_, state)) = self.sessions.remove(session_id) {
            let _ = state.session.close().await;
        }
        Ok(())
    }
}
