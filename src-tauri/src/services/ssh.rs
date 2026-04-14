use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use dashmap::DashMap;
use russh::keys::PublicKey;
use russh::{
    client::{self, Handle},
    keys::{decode_secret_key, key::PrivateKeyWithHashAlg},
    ChannelMsg, Disconnect,
};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

// ─── Minimal russh client handler ─────────────────────────────────────────────

pub struct SshClientHandler {
    host: String,
    port: u16,
    known_hosts_path: PathBuf,
    /// Populated when a host-key mismatch is detected; read by `connect` after
    /// the connection attempt to surface a human-readable error.
    rejection_reason: Arc<Mutex<Option<String>>>,
}

impl SshClientHandler {
    pub fn new(
        host: &str,
        port: u16,
        known_hosts_path: PathBuf,
        rejection_reason: Arc<Mutex<Option<String>>>,
    ) -> Self {
        Self {
            host: host.to_string(),
            port,
            known_hosts_path,
            rejection_reason,
        }
    }
}

impl client::Handler for SshClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        // Derive a stable fingerprint from the key's Debug representation, hashed
        // with SHA-256. Not IETF-standard but unique and stable for a given key.
        let key_repr = format!("{:?}", server_public_key);
        let digest =
            ring::digest::digest(&ring::digest::SHA256, key_repr.as_bytes());
        let fingerprint = B64.encode(digest.as_ref());

        let host_key = format!("{}:{}", self.host, self.port);

        // Load existing known-hosts (JSON map of "host:port" → fingerprint)
        let mut known_hosts: HashMap<String, String> =
            std::fs::read_to_string(&self.known_hosts_path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();

        match known_hosts.get(&host_key) {
            Some(stored) if stored == &fingerprint => {
                tracing::debug!("SSH TOFU: chave verificada para {}", host_key);
                Ok(true)
            }
            Some(_stored) => {
                // Key changed — possible MITM or server reinstall.
                let msg = format!(
                    "Chave SSH do servidor {} mudou desde a última conexão. \
                     Possível ataque MITM detectado. Se o servidor foi reinstalado, \
                     remova a entrada correspondente em known_hosts.json no diretório \
                     de dados do app e tente novamente.",
                    host_key
                );
                tracing::error!("{}", msg);
                *self.rejection_reason.lock().unwrap() = Some(msg);
                Ok(false)
            }
            None => {
                // Primeira conexão com este host — TOFU: confiar e registrar.
                tracing::info!(
                    "SSH TOFU: registrando nova chave para {} ({}...)",
                    host_key,
                    &fingerprint[..16]
                );
                known_hosts.insert(host_key, fingerprint);
                if let Ok(json) = serde_json::to_string_pretty(&known_hosts) {
                    if let Err(e) = std::fs::write(&self.known_hosts_path, &json) {
                        tracing::warn!("Falha ao salvar known_hosts.json: {}", e);
                    }
                }
                Ok(true)
            }
        }
    }
}

// ─── Messages sent from IPC handlers to the background SSH task ───────────────

enum SessionMsg {
    /// Raw bytes to write to the remote shell's stdin
    Data(Vec<u8>),
    /// Notify the remote PTY of a terminal resize
    Resize { cols: u32, rows: u32 },
}

// ─── Session state ────────────────────────────────────────────────────────────

struct SshSession {
    /// Used for clean disconnection and SFTP channel sharing
    handle: Arc<tokio::sync::Mutex<Handle<SshClientHandler>>>,
    /// Send messages (data or resize) to the background task
    msg_tx: mpsc::UnboundedSender<SessionMsg>,
}

// ─── Service ─────────────────────────────────────────────────────────────────

pub struct SshService {
    sessions: DashMap<String, SshSession>,
    known_hosts_path: PathBuf,
}

// ─── Auth helper ─────────────────────────────────────────────────────────────

/// Parse a PEM private key and authenticate the SSH handle with it.
/// `passphrase` is optional (for password-protected keys).
pub async fn authenticate_with_key(
    handle: &mut Handle<SshClientHandler>,
    username: &str,
    key_pem: &str,
    passphrase: Option<&str>,
) -> Result<()> {
    let private_key = decode_secret_key(key_pem, passphrase)
        .map_err(|e| anyhow!("Falha ao decodificar chave SSH: {}", e))?;

    let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(private_key), None);
    let auth_result = handle
        .authenticate_publickey(username, key_with_hash)
        .await?;

    if !matches!(auth_result, russh::client::AuthResult::Success) {
        return Err(anyhow!(
            "Autenticação por chave SSH falhou: chave rejeitada pelo servidor"
        ));
    }
    Ok(())
}

impl Default for SshService {
    fn default() -> Self {
        Self {
            sessions: DashMap::new(),
            known_hosts_path: PathBuf::from("known_hosts.json"),
        }
    }
}

impl SshService {
    pub fn new(app_data_dir: &Path) -> Self {
        Self {
            sessions: DashMap::new(),
            known_hosts_path: app_data_dir.join("known_hosts.json"),
        }
    }

    /// Return an Arc clone of the SSH Handle for a session (used to open SFTP sub-channels).
    pub async fn get_handle(
        &self,
        session_id: &str,
    ) -> Option<Arc<tokio::sync::Mutex<Handle<SshClientHandler>>>> {
        self.sessions.get(session_id).map(|s| Arc::clone(&s.handle))
    }

    /// Establish an SSH session, open an interactive PTY shell, and spawn a
    /// background task that emits `ssh://data/<session_id>` Tauri events.
    ///
    /// Authentication priority:
    ///   1. `ssh_key` (inline PEM) + optional `ssh_key_passphrase`
    ///   2. `password` (plain text)
    ///
    /// Returns the `session_id` on success.
    #[allow(clippy::too_many_arguments)]
    pub async fn connect(
        &self,
        app: AppHandle,
        host: &str,
        port: u16,
        username: &str,
        password: Option<&str>,
        ssh_key: Option<&str>,
        ssh_key_passphrase: Option<&str>,
        session_id: String,
        cols: Option<u32>,
        rows: Option<u32>,
    ) -> Result<String> {
        let initial_cols = cols.unwrap_or(80);
        let initial_rows = rows.unwrap_or(24);

        let config = std::sync::Arc::new(client::Config::default());

        // Shared state to capture host-key mismatch reason from the handler
        let rejection_reason: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        let handler = SshClientHandler::new(
            host,
            port,
            self.known_hosts_path.clone(),
            Arc::clone(&rejection_reason),
        );

        let mut handle = client::connect(config, (host, port), handler)
            .await
            .map_err(|e| {
                // Surface the specific TOFU mismatch message if available
                if let Some(msg) = rejection_reason.lock().unwrap().take() {
                    anyhow!("{}", msg)
                } else {
                    anyhow::Error::from(e)
                }
            })?;

        // ── Authenticate ────────────────────────────────────────────────────
        if let Some(key_pem) = ssh_key {
            // Prefer SSH key auth
            authenticate_with_key(&mut handle, username, key_pem, ssh_key_passphrase).await?;
        } else if let Some(pw) = password {
            // Fall back to password auth
            let auth_result = handle.authenticate_password(username, pw).await?;
            if !matches!(auth_result, russh::client::AuthResult::Success) {
                return Err(anyhow!(
                    "Autenticação SSH falhou: usuário ou senha incorretos"
                ));
            }
        } else {
            return Err(anyhow!(
                "Nenhuma credencial fornecida (senha ou chave SSH necessária)"
            ));
        }

        // Open an interactive shell session
        let mut channel = handle.channel_open_session().await?;

        // Request a PTY so the remote shell renders correctly in xterm
        channel
            .request_pty(
                true,
                "xterm-256color",
                initial_cols,
                initial_rows,
                0,
                0,
                &[],
            )
            .await?;

        channel.request_shell(false).await?;

        // Channel for sending messages (keystrokes + resize) from IPC handlers to the background task
        let (msg_tx, mut msg_rx) = mpsc::unbounded_channel::<SessionMsg>();

        // Background task: forward server output → Tauri events, and
        // forward keystrokes/resize from msg_rx → remote shell
        let sid = session_id.clone();
        let app_clone = app.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    // Incoming data from the SSH server
                    msg = channel.wait() => {
                        match msg {
                            Some(ChannelMsg::Data { ref data }) => {
                                let encoded = B64.encode(data.as_ref());
                                let _ = app_clone.emit(&format!("ssh://data/{sid}"), encoded);
                            }
                            Some(ChannelMsg::ExtendedData { ref data, .. }) => {
                                // stderr — show it in the terminal too
                                let encoded = B64.encode(data.as_ref());
                                let _ = app_clone.emit(&format!("ssh://data/{sid}"), encoded);
                            }
                            Some(ChannelMsg::ExitStatus { exit_status }) => {
                                let msg = format!("\r\n[Processo encerrado com código {}]\r\n", exit_status);
                                let encoded = B64.encode(msg.as_bytes());
                                let _ = app_clone.emit(&format!("ssh://data/{sid}"), encoded);
                            }
                            None | Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) => {
                                let _ = app_clone.emit(&format!("ssh://close/{sid}"), ());
                                break;
                            }
                            _ => {}
                        }
                    }

                    // Messages from the frontend (keystrokes or resize) → send to remote
                    session_msg = msg_rx.recv() => {
                        match session_msg {
                            Some(SessionMsg::Data(bytes)) => {
                                if channel.data(bytes.as_ref()).await.is_err() {
                                    break;
                                }
                            }
                            Some(SessionMsg::Resize { cols, rows }) => {
                                // Notify the remote PTY of the new terminal dimensions
                                let _ = channel.window_change(cols, rows, 0, 0).await;
                            }
                            // Sender dropped (ssh_disconnect called) → exit task
                            None => break,
                        }
                    }
                }
            }
        });

        self.sessions.insert(
            session_id.clone(),
            SshSession {
                handle: Arc::new(tokio::sync::Mutex::new(handle)),
                msg_tx,
            },
        );

        Ok(session_id)
    }

    /// Send raw bytes (base64-encoded) to the remote shell's stdin.
    pub async fn write(&self, session_id: &str, data_b64: &str) -> Result<()> {
        let bytes = B64.decode(data_b64)?;
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| anyhow!("Sessão SSH não encontrada: {}", session_id))?;
        session
            .msg_tx
            .send(SessionMsg::Data(bytes))
            .map_err(|_| anyhow!("Canal de escrita fechado para sessão: {}", session_id))?;
        Ok(())
    }

    /// Notify the remote PTY of a terminal resize.
    pub async fn resize(&self, session_id: &str, cols: u32, rows: u32) -> Result<()> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| anyhow!("Sessão SSH não encontrada: {}", session_id))?;
        session
            .msg_tx
            .send(SessionMsg::Resize { cols, rows })
            .map_err(|_| anyhow!("Canal de escrita fechado para sessão: {}", session_id))?;
        Ok(())
    }

    /// Disconnect and remove the session.
    pub async fn disconnect(&self, session_id: &str) -> Result<()> {
        if let Some((_, session)) = self.sessions.remove(session_id) {
            // Dropping msg_tx closes the mpsc channel → background task exits cleanly
            drop(session.msg_tx);
            let _ = session
                .handle
                .lock()
                .await
                .disconnect(Disconnect::ByApplication, "User closed terminal", "en")
                .await;
        }
        Ok(())
    }
}
