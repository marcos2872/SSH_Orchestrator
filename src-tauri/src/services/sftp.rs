use anyhow::{anyhow, Result};
use dashmap::DashMap;
use russh::client::{self, Handle};
use russh_sftp::{client::SftpSession, protocol::OpenFlags};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex as AsyncMutex;
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
    known_hosts_path: PathBuf,
}

impl Default for SftpService {
    fn default() -> Self {
        Self {
            sessions: DashMap::new(),
            known_hosts_path: PathBuf::from("known_hosts.json"),
        }
    }
}

impl SftpService {
    pub fn new(app_data_dir: &Path) -> Self {
        Self {
            sessions: DashMap::new(),
            known_hosts_path: app_data_dir.join("known_hosts.json"),
        }
    }

    /// Open an SFTP channel over an existing SSH Handle (stored as Arc<AsyncMutex<Handle>>).
    pub async fn open_session(
        &self,
        handle: Arc<AsyncMutex<Handle<SshClientHandler>>>,
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

        // TOFU host-key verification (same known_hosts.json used by SshService)
        let rejection_reason: Arc<std::sync::Mutex<Option<String>>> =
            Arc::new(std::sync::Mutex::new(None));
        let handler = SshClientHandler::new(
            host,
            port,
            self.known_hosts_path.clone(),
            Arc::clone(&rejection_reason),
        );

        let mut handle = client::connect(config, (host, port), handler)
            .await
            .map_err(|e| {
                if let Some(msg) = rejection_reason.lock().unwrap().take() {
                    anyhow!("{}", msg)
                } else {
                    anyhow::Error::from(e)
                }
            })?;

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

    /// Upload a single local file to a remote path, emitting progress events.
    /// The DashMap guard is released before the I/O loop to avoid holding a
    /// synchronous lock across async yield points.
    async fn upload_file(
        &self,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
        app: &AppHandle,
    ) -> Result<()> {
        let mut local_file = tokio::fs::File::open(local_path).await?;
        let total = local_file.metadata().await?.len();
        let file_name = Path::new(local_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| remote_path.to_string());

        // Open remote file while holding guard, then release guard before I/O loop.
        let flags = OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE;
        let mut remote_file = {
            let guard = self
                .sessions
                .get(session_id)
                .ok_or_else(|| anyhow!("Sessão SFTP não encontrada: {}", session_id))?;
            guard.session.open_with_flags(remote_path, flags).await?
            // guard dropped here
        };

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

        let mut buffer = [0u8; 65536];
        let mut done = 0u64;
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

    /// Upload a local file to a remote path (public, single-file).
    pub async fn upload(
        &self,
        session_id: &str,
        local_path: &str,
        remote_path: &str,
        app: &AppHandle,
    ) -> Result<()> {
        self.upload_file(session_id, local_path, remote_path, app)
            .await
    }

    /// Upload a local file or directory recursively to a remote path.
    /// For directories, creates the remote directory and recurses into children.
    pub fn upload_recursive<'a>(
        &'a self,
        session_id: &'a str,
        local_path: &'a str,
        remote_path: &'a str,
        app: &'a AppHandle,
    ) -> Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            if Path::new(local_path).is_dir() {
                // Create remote directory, ignore error if it already exists.
                {
                    let guard = self
                        .sessions
                        .get(session_id)
                        .ok_or_else(|| anyhow!("Sessão SFTP não encontrada: {}", session_id))?;
                    let _ = guard.session.create_dir(remote_path).await;
                    // guard dropped
                }
                let read_dir = std::fs::read_dir(local_path)
                    .map_err(|e| anyhow!("Erro ao listar '{}': {}", local_path, e))?;
                for entry in read_dir {
                    let entry = entry?;
                    let child_local = entry.path().to_string_lossy().to_string();
                    let child_name = entry.file_name().to_string_lossy().to_string();
                    let child_remote =
                        format!("{}/{}", remote_path.trim_end_matches('/'), child_name);
                    self.upload_recursive(session_id, &child_local, &child_remote, app)
                        .await?;
                }
            } else {
                self.upload_file(session_id, local_path, remote_path, app)
                    .await?;
            }
            Ok(())
        })
    }

    /// Download a single remote file to a local path, emitting progress events.
    /// The DashMap guard is released before the I/O loop.
    async fn download_file(
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

        // Open remote file + stat while holding guard, then release.
        let (mut remote_file, total) = {
            let guard = self
                .sessions
                .get(session_id)
                .ok_or_else(|| anyhow!("Sessão SFTP não encontrada: {}", session_id))?;
            let f = guard.session.open(remote_path).await?;
            let meta = f.metadata().await?;
            let sz = meta.size.unwrap_or(0);
            (f, sz)
            // guard dropped here
        };

        let mut local_file = tokio::fs::File::create(local_path).await?;

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

        let mut buffer = [0u8; 65536];
        let mut done = 0u64;
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

    /// Download a remote file to a local path (public, single-file).
    pub async fn download(
        &self,
        session_id: &str,
        remote_path: &str,
        local_path: &str,
        app: &AppHandle,
    ) -> Result<()> {
        self.download_file(session_id, remote_path, local_path, app)
            .await
    }

    /// Download a remote file or directory recursively to a local path.
    /// For directories, creates the local directory and recurses into children.
    pub fn download_recursive<'a>(
        &'a self,
        session_id: &'a str,
        remote_path: &'a str,
        local_path: &'a str,
        app: &'a AppHandle,
    ) -> Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            // Stat the remote path. Guard released after the await.
            let is_dir = {
                let guard = self
                    .sessions
                    .get(session_id)
                    .ok_or_else(|| anyhow!("Sessão SFTP não encontrada: {}", session_id))?;
                let meta = guard.session.metadata(remote_path).await?;
                meta.is_dir()
                // guard dropped
            };

            if is_dir {
                tokio::fs::create_dir_all(local_path).await?;
                // List remote directory, collecting into Vec so guard is released.
                let entries: Vec<_> = {
                    let guard = self
                        .sessions
                        .get(session_id)
                        .ok_or_else(|| anyhow!("Sessão SFTP não encontrada: {}", session_id))?;
                    guard.session.read_dir(remote_path).await?.collect()
                    // guard dropped
                };
                for entry in entries {
                    let name = entry.file_name();
                    if name == "." || name == ".." {
                        continue;
                    }
                    let child_remote =
                        format!("{}/{}", remote_path.trim_end_matches('/'), name);
                    let child_local =
                        format!("{}/{}", local_path.trim_end_matches('/'), name);
                    self.download_recursive(session_id, &child_remote, &child_local, app)
                        .await?;
                }
            } else {
                self.download_file(session_id, remote_path, local_path, app)
                    .await?;
            }
            Ok(())
        })
    }

    /// Delete a file or directory (recursivamente para diretórios não-vazios).
    pub async fn delete(&self, session_id: &str, path: &str) -> Result<()> {
        // Tenta como arquivo primeiro
        let remove_file_result = {
            let guard = self
                .sessions
                .get(session_id)
                .ok_or_else(|| anyhow!("Sessão SFTP não encontrada: {}", session_id))?;
            guard.session.remove_file(path).await
        };

        if remove_file_result.is_ok() {
            return Ok(());
        }

        // Não é arquivo — verifica se é diretório
        let is_dir = {
            let guard = self
                .sessions
                .get(session_id)
                .ok_or_else(|| anyhow!("Sessão SFTP não encontrada: {}", session_id))?;
            guard
                .session
                .metadata(path)
                .await
                .map(|m| m.is_dir())
                .unwrap_or(false)
        };

        if is_dir {
            self.delete_dir_recursive(session_id, path).await
        } else {
            // Retorna o erro original da remoção de arquivo
            remove_file_result
                .map_err(|e| anyhow!("Falha ao remover '{}': {}", path, e))
        }
    }

    /// Remove recursivamente um diretório remoto e todo o seu conteúdo.
    fn delete_dir_recursive<'a>(
        &'a self,
        session_id: &'a str,
        path: &'a str,
    ) -> Pin<Box<dyn std::future::Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            // Listar o diretório e soltar o guard antes de recursividade
            let entries: Vec<_> = {
                let guard = self
                    .sessions
                    .get(session_id)
                    .ok_or_else(|| anyhow!("Sessão SFTP não encontrada: {}", session_id))?;
                guard.session.read_dir(path).await?.collect()
            };

            for entry in entries {
                let name = entry.file_name();
                if name == "." || name == ".." {
                    continue;
                }
                let child = format!("{}/{}", path.trim_end_matches('/'), name);
                if entry.file_type().is_dir() {
                    self.delete_dir_recursive(session_id, &child).await?;
                } else {
                    let guard = self
                        .sessions
                        .get(session_id)
                        .ok_or_else(|| anyhow!("Sessão SFTP não encontrada: {}", session_id))?;
                    guard.session.remove_file(&child).await?;
                }
            }

            // Diretório agora vazio — remover
            let guard = self
                .sessions
                .get(session_id)
                .ok_or_else(|| anyhow!("Sessão SFTP não encontrada: {}", session_id))?;
            guard
                .session
                .remove_dir(path)
                .await
                .map_err(|e| anyhow!("Falha ao remover diretório '{}': {}", path, e))
        })
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
