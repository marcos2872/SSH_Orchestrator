use anyhow::{anyhow, Result};
use dashmap::DashMap;
use russh::client::{self, Handle};
use russh_sftp::{client::SftpSession, protocol::OpenFlags};
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::services::ssh::{authenticate_with_key, SshClientHandler};

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
    // Store handle for direct connections to keep them alive
    _handle: Option<Handle<SshClientHandler>>,
}

// ─── Service ─────────────────────────────────────────────────────────────────

pub struct SftpService {
    sessions: DashMap<String, SftpState>,
}

impl Default for SftpService {
    fn default() -> Self {
        Self::new()
    }
}

impl SftpService {
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
        }
    }

    /// Open an SFTP channel over an existing SSH Handle (stored as Arc<Mutex<Handle>>).
    pub async fn open_session(
        &self,
        handle: Arc<Mutex<Handle<SshClientHandler>>>,
    ) -> Result<String> {
        let channel = handle.lock().await.channel_open_session().await?;
        channel.request_subsystem(true, "sftp").await?;
        let session = SftpSession::new(channel.into_stream()).await?;
        let id = Uuid::new_v4().to_string();
        self.sessions.insert(
            id.clone(),
            SftpState {
                session,
                _handle: None,
            },
        );
        Ok(id)
    }

    /// Create a direct SSH + SFTP connection (no PTY/shell) for the dual-pane file manager.
    /// Returns the SFTP session ID.
    ///
    /// Authentication priority:
    ///   1. `ssh_key` (inline PEM) + optional `ssh_key_passphrase`
    ///   2. `password` (plain text)
    pub async fn open_direct(
        &self,
        host: &str,
        port: u16,
        username: &str,
        password: Option<&str>,
        ssh_key: Option<&str>,
        ssh_key_passphrase: Option<&str>,
    ) -> Result<String> {
        let config = Arc::new(client::Config::default());
        let mut handle = client::connect(config, (host, port), SshClientHandler).await?;

        if let Some(key_pem) = ssh_key {
            authenticate_with_key(&mut handle, username, key_pem, ssh_key_passphrase).await?;
        } else if let Some(pw) = password {
            let auth = handle.authenticate_password(username, pw).await?;
            if !matches!(auth, russh::client::AuthResult::Success) {
                return Err(anyhow!("Autenticação SSH falhou"));
            }
        } else {
            return Err(anyhow!(
                "Nenhuma credencial fornecida (senha ou chave SSH necessária)"
            ));
        }

        let channel = handle.channel_open_session().await?;
        channel.request_subsystem(true, "sftp").await?;
        let session = SftpSession::new(channel.into_stream()).await?;
        let id = Uuid::new_v4().to_string();
        self.sessions.insert(
            id.clone(),
            SftpState {
                session,
                _handle: Some(handle),
            },
        );
        Ok(id)
    }

    /// Return the remote working directory (home) via SFTP realpath(".").
    pub async fn workdir(&self, session_id: &str) -> Result<String> {
        let guard = self
            .sessions
            .get(session_id)
            .ok_or_else(|| anyhow!("Sessão SFTP não encontrada: {}", session_id))?;
        let path = guard.session.canonicalize(".").await?;
        Ok(path)
    }

    /// Return the local home directory.
    pub fn home_dir(&self) -> String {
        std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
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
            if name.starts_with('.') {
                continue;
            }
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

    /// Delete a local file or directory.
    pub fn delete_local(&self, path: &str) -> Result<()> {
        let p = std::path::Path::new(path);
        if p.is_dir() {
            std::fs::remove_dir_all(p)?;
        } else {
            std::fs::remove_file(p)?;
        }
        Ok(())
    }

    /// Rename a local file or directory.
    pub fn rename_local(&self, from: &str, to: &str) -> Result<()> {
        std::fs::rename(from, to)?;
        Ok(())
    }

    /// Create a local directory.
    pub fn mkdir_local(&self, path: &str) -> Result<()> {
        std::fs::create_dir_all(path)?;
        Ok(())
    }

    /// List directory contents.
    pub async fn list_dir(&self, session_id: &str, path: &str) -> Result<Vec<SftpEntry>> {
        let guard = self
            .sessions
            .get(session_id)
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
        let mut local_file = tokio::fs::File::open(local_path).await?;
        let total = local_file.metadata().await?.len();
        let file_name = std::path::Path::new(local_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| remote_path.to_string());

        let guard = self
            .sessions
            .get(session_id)
            .ok_or_else(|| anyhow!("Sessão SFTP não encontrada: {}", session_id))?;

        let flags = OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE;
        let mut remote_file = guard.session.open_with_flags(remote_path, flags).await?;

        // Emit 0% progress
        let progress_event = format!("sftp://progress/{}", session_id);
        let _ = app.emit(
            &progress_event,
            ProgressEvent {
                session_id: session_id.to_string(),
                file: file_name.clone(),
                bytes_done: 0,
                bytes_total: total,
            },
        );

        let mut buffer = [0u8; 65536]; // 64KB buffer
        let mut done = 0;

        loop {
            let n = local_file.read(&mut buffer).await?;
            if n == 0 {
                break;
            }
            remote_file.write_all(&buffer[..n]).await?;
            done += n as u64;

            let _ = app.emit(
                &progress_event,
                ProgressEvent {
                    session_id: session_id.to_string(),
                    file: file_name.clone(),
                    bytes_done: done,
                    bytes_total: total,
                },
            );
        }

        Ok(())
    }

    /// Download a remote file to a local path, emitting progress events.
    pub async fn download(
        &self,
        session_id: &str,
        remote_path: &str,
        local_path: &str,
        app: &AppHandle,
    ) -> Result<()> {
        let file_name = remote_path
            .split('/')
            .next_back()
            .unwrap_or(remote_path)
            .to_string();

        let guard = self
            .sessions
            .get(session_id)
            .ok_or_else(|| anyhow!("Sessão SFTP não encontrada: {}", session_id))?;

        let mut remote_file = guard.session.open(remote_path).await?;
        let metadata = remote_file.metadata().await?;
        let total = metadata.size.unwrap_or(0);

        // Drop guard early if possible but we need session for read
        // However, russh-sftp File holds a reference to the session? No, it holds the channel.
        // Actually, DashMap Ref prevents other writes to that segment.
        // Let's copy session or just hold it. For now, hold it.

        let mut local_file = tokio::fs::File::create(local_path).await?;

        // Emit 0% progress
        let progress_event = format!("sftp://progress/{}", session_id);
        let _ = app.emit(
            &progress_event,
            ProgressEvent {
                session_id: session_id.to_string(),
                file: file_name.clone(),
                bytes_done: 0,
                bytes_total: total,
            },
        );

        let mut buffer = [0u8; 65536]; // 64KB buffer
        let mut done = 0;

        loop {
            let n = remote_file.read(&mut buffer).await?;
            if n == 0 {
                break;
            }
            local_file.write_all(&buffer[..n]).await?;
            done += n as u64;

            let _ = app.emit(
                &progress_event,
                ProgressEvent {
                    session_id: session_id.to_string(),
                    file: file_name.clone(),
                    bytes_done: done,
                    bytes_total: total,
                },
            );
        }

        Ok(())
    }

    /// Delete a file or directory.
    pub async fn delete(&self, session_id: &str, path: &str) -> Result<()> {
        let guard = self
            .sessions
            .get(session_id)
            .ok_or_else(|| anyhow!("Sessão SFTP não encontrada: {}", session_id))?;
        if guard.session.remove_file(path).await.is_err() {
            guard.session.remove_dir(path).await?;
        }
        Ok(())
    }

    /// Rename / move a path.
    pub async fn rename(&self, session_id: &str, from: &str, to: &str) -> Result<()> {
        let guard = self
            .sessions
            .get(session_id)
            .ok_or_else(|| anyhow!("Sessão SFTP não encontrada: {}", session_id))?;
        guard.session.rename(from, to).await?;
        Ok(())
    }

    /// Create a remote directory.
    pub async fn mkdir(&self, session_id: &str, path: &str) -> Result<()> {
        let guard = self
            .sessions
            .get(session_id)
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
