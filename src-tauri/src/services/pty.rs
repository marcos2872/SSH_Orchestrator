use anyhow::{anyhow, Result};
use dashmap::DashMap;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{Read, Write};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

// ─── Messages sent from IPC handlers to the background PTY writer thread ──────

enum PtyMsg {
    /// Raw bytes to write to the local shell's stdin
    Data(Vec<u8>),
    /// Notify the local PTY of a terminal resize
    Resize { cols: u16, rows: u16 },
}

// ─── Session state ────────────────────────────────────────────────────────────

struct PtySession {
    /// Send messages (data or resize) to the writer thread
    msg_tx: std::sync::mpsc::Sender<PtyMsg>,
}

// ─── Service ─────────────────────────────────────────────────────────────────

pub struct PtyService {
    sessions: DashMap<String, PtySession>,
}

impl Default for PtyService {
    fn default() -> Self {
        Self::new()
    }
}

impl PtyService {
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
        }
    }

    /// Spawn a local shell in a PTY and return the session ID.
    ///
    /// Output is delivered to the frontend via Tauri events (`pty://data/{session_id}`).
    /// When the shell exits, a `pty://close/{session_id}` event is emitted.
    ///
    /// This method uses only `std::thread` and `std::sync::mpsc` — it does **not**
    /// require a Tokio runtime and is safe to call from synchronous Tauri commands.
    pub fn spawn(
        &self,
        app: AppHandle,
        session_id: String,
        cols: u16,
        rows: u16,
        shell: Option<String>,
    ) -> Result<String> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| anyhow!("Failed to open PTY: {}", e))?;

        // Detect the default shell for the current OS
        let shell_cmd = shell.unwrap_or_else(detect_default_shell);

        let mut cmd = CommandBuilder::new(&shell_cmd);

        // Set a reasonable TERM value so TUI apps render correctly
        cmd.env("TERM", "xterm-256color");

        // On Unix, start a login shell for proper profile loading
        #[cfg(unix)]
        {
            cmd.arg("-l");
        }

        let _child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| anyhow!("Failed to spawn shell '{}': {}", shell_cmd, e))?;

        // Drop the slave side — we only interact through the master
        drop(pair.slave);

        // Obtain reader and writer from the master PTY.
        // try_clone_reader() clones the read side; take_writer() consumes the write side.
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| anyhow!("Failed to clone PTY reader: {}", e))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| anyhow!("Failed to take PTY writer: {}", e))?;

        // Keep the master alive in an Arc so the writer thread can call resize on it.
        let master = Arc::new(std::sync::Mutex::new(pair.master));

        let (msg_tx, msg_rx) = std::sync::mpsc::channel::<PtyMsg>();

        // ── Writer thread: receive messages from the frontend and write to PTY ──
        let sid_writer = session_id.clone();
        let master_for_writer = Arc::clone(&master);
        std::thread::Builder::new()
            .name(format!("pty-writer-{}", &session_id))
            .spawn(move || {
                let mut writer = writer;
                loop {
                    match msg_rx.recv() {
                        Ok(PtyMsg::Data(bytes)) => {
                            if writer.write_all(&bytes).is_err() {
                                tracing::debug!("PTY writer closed for session {}", sid_writer);
                                break;
                            }
                            let _ = writer.flush();
                        }
                        Ok(PtyMsg::Resize { cols, rows }) => {
                            if let Ok(master) = master_for_writer.lock() {
                                let _ = master.resize(PtySize {
                                    rows,
                                    cols,
                                    pixel_width: 0,
                                    pixel_height: 0,
                                });
                            }
                        }
                        // Sender dropped (pty_kill called) → exit thread
                        Err(_) => break,
                    }
                }
            })
            .map_err(|e| anyhow!("Failed to spawn PTY writer thread: {}", e))?;

        // ── Reader thread: read PTY output and emit Tauri events ────────────────
        let sid_reader = session_id.clone();
        let app_clone = app.clone();
        std::thread::Builder::new()
            .name(format!("pty-reader-{}", &session_id))
            .spawn(move || {
                let mut reader = reader;
                let mut buf = vec![0u8; 4096];

                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => {
                            // EOF — shell exited
                            let _ = app_clone.emit(&format!("pty://close/{}", sid_reader), ());
                            break;
                        }
                        Ok(n) => {
                            let encoded = base64::Engine::encode(
                                &base64::engine::general_purpose::STANDARD,
                                &buf[..n],
                            );
                            let _ = app_clone.emit(&format!("pty://data/{}", sid_reader), encoded);
                        }
                        Err(e) => {
                            tracing::debug!("PTY read error for session {}: {}", sid_reader, e);
                            let _ = app_clone.emit(&format!("pty://close/{}", sid_reader), ());
                            break;
                        }
                    }
                }
            })
            .map_err(|e| anyhow!("Failed to spawn PTY reader thread: {}", e))?;

        self.sessions
            .insert(session_id.clone(), PtySession { msg_tx });

        Ok(session_id)
    }

    /// Send raw bytes to the local shell's stdin.
    pub fn write(&self, session_id: &str, data: &[u8]) -> Result<()> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| anyhow!("Sessão PTY não encontrada: {}", session_id))?;
        session
            .msg_tx
            .send(PtyMsg::Data(data.to_vec()))
            .map_err(|_| anyhow!("Canal de escrita fechado para sessão PTY: {}", session_id))?;
        Ok(())
    }

    /// Notify the local PTY of a terminal resize.
    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<()> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| anyhow!("Sessão PTY não encontrada: {}", session_id))?;
        session
            .msg_tx
            .send(PtyMsg::Resize { cols, rows })
            .map_err(|_| anyhow!("Canal de escrita fechado para sessão PTY: {}", session_id))?;
        Ok(())
    }

    /// Kill the local shell and remove the session.
    pub fn kill(&self, session_id: &str) -> Result<()> {
        if let Some((_, session)) = self.sessions.remove(session_id) {
            // Dropping msg_tx closes the std::sync::mpsc channel → writer thread exits cleanly.
            // The writer thread holds the last Arc<Mutex<master>>, so when it exits
            // the master PTY is dropped → the reader thread gets EOF and exits too.
            drop(session.msg_tx);
        }
        Ok(())
    }
}

/// Detect the default shell for the current operating system.
fn detect_default_shell() -> String {
    #[cfg(unix)]
    {
        if let Ok(shell) = std::env::var("SHELL") {
            if !shell.is_empty() {
                return shell;
            }
        }
        "/bin/bash".to_string()
    }

    #[cfg(windows)]
    {
        if let Ok(comspec) = std::env::var("COMSPEC") {
            if !comspec.is_empty() {
                return comspec;
            }
        }
        "powershell.exe".to_string()
    }
}
