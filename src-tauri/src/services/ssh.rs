use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use dashmap::DashMap;
use russh::{
    client::{self, Handle},
    keys::PublicKey,
    ChannelMsg, Disconnect,
};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex};

// ─── Minimal russh client handler ─────────────────────────────────────────────
// Data routing is handled by the channel.wait() loop below, not the handler.

pub struct SshClientHandler;

impl client::Handler for SshClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &PublicKey,
    ) -> Result<bool, Self::Error> {
        // Phase 0.1: TOFU - trust all server keys
        // Phase 1.0 will implement known_hosts verification
        Ok(true)
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
    handle: Arc<Mutex<Handle<SshClientHandler>>>,
    /// Send messages (data or resize) to the background task
    msg_tx: mpsc::UnboundedSender<SessionMsg>,
}

// ─── Service ─────────────────────────────────────────────────────────────────

pub struct SshService {
    sessions: DashMap<String, SshSession>,
}

impl SshService {
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
        }
    }

    /// Return an Arc clone of the SSH Handle for a session (used to open SFTP sub-channels).
    pub async fn get_handle(
        &self,
        session_id: &str,
    ) -> Option<Arc<Mutex<Handle<SshClientHandler>>>> {
        self.sessions.get(session_id).map(|s| Arc::clone(&s.handle))
    }

    /// Establish an SSH session with password auth, open an interactive PTY shell,
    /// and spawn a background task that emits `ssh://data/<session_id>` Tauri events.
    ///
    /// `cols` and `rows` set the initial PTY size. If not provided, defaults to 80×24.
    ///
    /// Returns the `session_id` on success.
    pub async fn connect(
        &self,
        app: AppHandle,
        host: &str,
        port: u16,
        username: &str,
        password: &str,
        session_id: String,
        cols: Option<u32>,
        rows: Option<u32>,
    ) -> Result<String> {
        let initial_cols = cols.unwrap_or(80);
        let initial_rows = rows.unwrap_or(24);

        let config = std::sync::Arc::new(client::Config::default());
        let mut handle = client::connect(config, (host, port), SshClientHandler).await?;

        let auth_result = handle.authenticate_password(username, password).await?;

        if !matches!(auth_result, russh::client::AuthResult::Success) {
            return Err(anyhow!(
                "Autenticação SSH falhou: usuário ou senha incorretos"
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
                handle: Arc::new(Mutex::new(handle)),
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
