use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use dashmap::DashMap;
use russh::{
    client::{self, Handle},
    keys::PublicKey,
    ChannelMsg, Disconnect,
};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use uuid::Uuid;

// ─── Minimal russh client handler ─────────────────────────────────────────────
// Data routing is handled by the channel.wait() loop below, not the handler.

struct SshClientHandler;

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

// ─── Session state ────────────────────────────────────────────────────────────

struct SshSession {
    /// Used for clean disconnection
    handle: Handle<SshClientHandler>,
    /// Send bytes here to write them to the remote shell
    writer_tx: mpsc::UnboundedSender<Vec<u8>>,
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

    /// Establish an SSH session with password auth, open an interactive PTY shell,
    /// and spawn a background task that emits `ssh://data/<session_id>` Tauri events.
    ///
    /// Returns the `session_id` on success.
    pub async fn connect(
        &self,
        app: AppHandle,
        host: &str,
        port: u16,
        username: &str,
        password: &str,
    ) -> Result<String> {
        let session_id = Uuid::new_v4().to_string();

        let config = std::sync::Arc::new(client::Config::default());
        let mut handle = client::connect(config, (host, port), SshClientHandler).await?;

        let auth_result = handle
            .authenticate_password(username, password)
            .await?;

        if !matches!(auth_result, russh::client::AuthResult::Success) {
            return Err(anyhow!("Autenticação SSH falhou: usuário ou senha incorretos"));
        }

        // Open an interactive shell session
        let mut channel = handle.channel_open_session().await?;

        // Request a PTY so the remote shell renders correctly in xterm
        channel
            .request_pty(
                false,
                "xterm-256color",
                220, // cols
                50,  // rows
                0,
                0,
                &[],
            )
            .await?;

        channel.request_shell(false).await?;

        // Channel for sending keystroke data from ssh_write to the background task
        let (writer_tx, mut writer_rx) = mpsc::unbounded_channel::<Vec<u8>>();

        // Background task: forward server output → Tauri events, and
        // forward keystrokes from writer_rx → remote shell
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

                    // Keystrokes from the frontend → send to remote shell
                    data = writer_rx.recv() => {
                        match data {
                            Some(bytes) => {
                                if channel.data(bytes.as_ref()).await.is_err() {
                                    break;
                                }
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
            SshSession { handle, writer_tx },
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
            .writer_tx
            .send(bytes)
            .map_err(|_| anyhow!("Canal de escrita fechado para sessão: {}", session_id))?;
        Ok(())
    }

    /// Disconnect and remove the session.
    pub async fn disconnect(&self, session_id: &str) -> Result<()> {
        if let Some((_, session)) = self.sessions.remove(session_id) {
            // Dropping writer_tx closes the mpsc channel → background task exits cleanly
            drop(session.writer_tx);
            let _ = session
                .handle
                .disconnect(Disconnect::ByApplication, "User closed terminal", "en")
                .await;
        }
        Ok(())
    }
}
