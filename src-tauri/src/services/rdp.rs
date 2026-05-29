//! Serviço RDP que se comunica com o sidecar `rdp-bridge` via JSON-over-stdio.
//!
//! O sidecar é um binário independente que usa IronRDP internamente,
//! evitando conflitos de dependência com russh no app principal.

use anyhow::{anyhow, Context, Result};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;

// ─── Types emitted to frontend ────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct RdpFrameEvent {
    pub x: u16,
    pub y: u16,
    pub w: u16,
    pub h: u16,
    /// Formato: "jpeg" ou "rgba"
    pub format: String,
    /// Pixel data codificado em base64 (JPEG ou RGBA conforme format)
    pub data: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RdpResolutionEvent {
    pub width: u16,
    pub height: u16,
}

// ─── Sidecar protocol types ───────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(tag = "type")]
enum BridgeCommand {
    #[serde(rename = "connect")]
    Connect {
        session_id: String,
        host: String,
        port: u16,
        username: String,
        password: String,
        width: u16,
        height: u16,
        use_tls: bool,
    },
    #[serde(rename = "disconnect")]
    Disconnect { session_id: String },
    #[serde(rename = "mouse")]
    Mouse {
        session_id: String,
        x: u16,
        y: u16,
        flags: u16,
    },
    #[serde(rename = "key")]
    Key {
        session_id: String,
        scancode: u16,
        is_pressed: bool,
        is_extended: bool,
    },
    #[serde(rename = "unicode")]
    Unicode {
        session_id: String,
        code_point: u16,
        is_pressed: bool,
    },
    #[serde(rename = "clipboard")]
    Clipboard {
        session_id: String,
        text: String,
    },
    #[serde(rename = "resize")]
    Resize {
        session_id: String,
        width: u16,
        height: u16,
    },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
enum BridgeEvent {
    #[serde(rename = "connected")]
    Connected {
        session_id: String,
        width: u16,
        height: u16,
    },
    #[serde(rename = "frame")]
    Frame {
        session_id: String,
        x: u16,
        y: u16,
        width: u16,
        height: u16,
        format: String,
        data_b64: String,
    },
    #[serde(rename = "disconnected")]
    Disconnected {
        session_id: String,
        reason: String,
    },
    #[serde(rename = "error")]
    Error { message: String },
    #[serde(rename = "clipboard_received")]
    ClipboardReceived {
        session_id: String,
        text: String,
    },
    #[serde(rename = "resolution")]
    Resolution {
        session_id: String,
        width: u16,
        height: u16,
    },
}

// ─── Service ─────────────────────────────────────────────────────────────────

struct RdpBridgeProcess {
    /// Canal para enviar comandos ao sidecar
    cmd_tx: mpsc::UnboundedSender<BridgeCommand>,
    /// Handle do processo filho (para matar no drop)
    _child: Arc<tokio::sync::Mutex<Child>>,
}

pub struct RdpService {
    sessions: DashMap<String, ()>,
    bridge: Arc<tokio::sync::Mutex<Option<RdpBridgeProcess>>>,
    sidecar_path: std::path::PathBuf,
}

impl RdpService {
    pub fn new(app_data_dir: &Path) -> Self {
        // Procura o sidecar em múltiplas localizações:
        // 1. Ao lado do executável principal (produção/bundle)
        // 2. No diretório do projeto rdp-bridge (desenvolvimento)
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()));

        let sidecar_path = if let Some(ref dir) = exe_dir {
            let next_to_exe = dir.join("rdp-bridge");
            if next_to_exe.exists() {
                next_to_exe
            } else {
                // Dev mode: rdp-bridge/target/debug/rdp-bridge
                // O exe principal fica em src-tauri/target/debug/
                // Então subimos 3 níveis: debug → target → src-tauri → project root
                let project_root = dir
                    .parent() // target/
                    .and_then(|p| p.parent()) // src-tauri/
                    .and_then(|p| p.parent()); // project root

                if let Some(root) = project_root {
                    let dev_path = root.join("rdp-bridge/target/debug/rdp-bridge");
                    if dev_path.exists() {
                        dev_path
                    } else {
                        // Fallback: release build
                        root.join("rdp-bridge/target/release/rdp-bridge")
                    }
                } else {
                    next_to_exe
                }
            }
        } else {
            app_data_dir.join("rdp-bridge")
        };

        tracing::info!("RDP sidecar path: {:?}", sidecar_path);

        Self {
            sessions: DashMap::new(),
            bridge: Arc::new(tokio::sync::Mutex::new(None)),
            sidecar_path,
        }
    }

    /// Garante que o processo sidecar está rodando
    async fn ensure_bridge(&self, app: &AppHandle) -> Result<()> {
        let mut bridge_lock = self.bridge.lock().await;
        if bridge_lock.is_some() {
            return Ok(());
        }

        tracing::info!("Iniciando sidecar rdp-bridge: {:?}", self.sidecar_path);

        let mut child = Command::new(&self.sidecar_path)
            .env("RUST_LOG", "rdp_bridge=debug")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .with_context(|| format!(
                "Falha ao iniciar rdp-bridge em {:?}",
                self.sidecar_path
            ))?;

        let stdin = child.stdin.take().context("stdin do sidecar não disponível")?;
        let stdout = child.stdout.take().context("stdout do sidecar não disponível")?;
        let stderr = child.stderr.take().context("stderr do sidecar não disponível")?;

        // Canal para enviar comandos ao writer
        let (cmd_tx, mut cmd_rx) = mpsc::unbounded_channel::<BridgeCommand>();

        // Task: escrever comandos em stdin do sidecar
        let mut stdin_writer = stdin;
        tokio::spawn(async move {
            while let Some(cmd) = cmd_rx.recv().await {
                match serde_json::to_string(&cmd) {
                    Ok(json) => {
                        let line = format!("{}\n", json);
                        if stdin_writer.write_all(line.as_bytes()).await.is_err() {
                            break;
                        }
                        let _ = stdin_writer.flush().await;
                    }
                    Err(e) => {
                        tracing::error!("Falha ao serializar comando para sidecar: {}", e);
                    }
                }
            }
        });

        // Task: ler eventos de stdout do sidecar e emitir para frontend
        let app_clone = app.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                if line.trim().is_empty() {
                    continue;
                }

                match serde_json::from_str::<BridgeEvent>(&line) {
                    Ok(event) => handle_bridge_event(&app_clone, event),
                    Err(e) => {
                        tracing::warn!("Evento inválido do sidecar: {} — linha: {}", e, line);
                    }
                }
            }

            tracing::info!("Stdout do sidecar encerrado");
        });

        // Task: log stderr do sidecar
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();

            while let Ok(Some(line)) = lines.next_line().await {
                tracing::info!("[rdp-bridge] {}", line);
            }
        });

        *bridge_lock = Some(RdpBridgeProcess {
            cmd_tx,
            _child: Arc::new(tokio::sync::Mutex::new(child)),
        });

        Ok(())
    }

    /// Envia um comando para o sidecar
    async fn send_command(&self, cmd: BridgeCommand) -> Result<()> {
        let bridge_lock = self.bridge.lock().await;
        let bridge = bridge_lock
            .as_ref()
            .ok_or_else(|| anyhow!("Sidecar rdp-bridge não está rodando"))?;
        bridge
            .cmd_tx
            .send(cmd)
            .map_err(|_| anyhow!("Canal de comando do sidecar fechado"))
    }

    /// Conecta a um servidor RDP via sidecar
    #[allow(clippy::too_many_arguments)]
    pub async fn connect(
        &self,
        app: AppHandle,
        host: &str,
        port: u16,
        username: &str,
        password: &str,
        _domain: Option<&str>,
        session_id: String,
        width: u16,
        height: u16,
    ) -> Result<String> {
        self.ensure_bridge(&app).await?;

        tracing::info!("RDP: conectando sessão {} a {}:{}", session_id, host, port);

        self.send_command(BridgeCommand::Connect {
            session_id: session_id.clone(),
            host: host.to_string(),
            port,
            username: username.to_string(),
            password: password.to_string(),
            width,
            height,
            use_tls: true,
        })
        .await?;

        self.sessions.insert(session_id.clone(), ());

        Ok(session_id)
    }

    /// Envia input de mouse
    pub async fn send_mouse(
        &self,
        session_id: &str,
        x: u16,
        y: u16,
        button: u8,
        flags: u16,
    ) -> Result<()> {
        if !self.sessions.contains_key(session_id) {
            anyhow::bail!("Sessão RDP não encontrada: {}", session_id);
        }
        // Combina o botão (1=esq, 2=dir, 3=meio) com os flags de evento.
        // PTRFLAGS_BUTTON1=0x1000, BUTTON2=0x2000, BUTTON3=0x4000.
        // Sem isso, um clique enviaria PTRFLAGS_DOWN sem identificar o botão.
        let button_flag = match button {
            1 => 0x1000,
            2 => 0x2000,
            3 => 0x4000,
            _ => 0x0000,
        };
        self.send_command(BridgeCommand::Mouse {
            session_id: session_id.to_string(),
            x,
            y,
            flags: flags | button_flag,
        })
        .await
    }

    /// Envia input de teclado
    pub async fn send_key(
        &self,
        session_id: &str,
        scancode: u16,
        is_down: bool,
        is_extended: bool,
    ) -> Result<()> {
        if !self.sessions.contains_key(session_id) {
            anyhow::bail!("Sessão RDP não encontrada: {}", session_id);
        }
        self.send_command(BridgeCommand::Key {
            session_id: session_id.to_string(),
            scancode,
            is_pressed: is_down,
            is_extended,
        })
        .await
    }

    /// Envia tecla unicode
    pub async fn send_unicode_key(
        &self,
        session_id: &str,
        unicode: u16,
        is_down: bool,
    ) -> Result<()> {
        if !self.sessions.contains_key(session_id) {
            anyhow::bail!("Sessão RDP não encontrada: {}", session_id);
        }
        self.send_command(BridgeCommand::Unicode {
            session_id: session_id.to_string(),
            code_point: unicode,
            is_pressed: is_down,
        })
        .await
    }

    /// Envia texto para clipboard remoto
    pub async fn send_clipboard(&self, session_id: &str, text: String) -> Result<()> {
        if !self.sessions.contains_key(session_id) {
            anyhow::bail!("Sessão RDP não encontrada: {}", session_id);
        }
        self.send_command(BridgeCommand::Clipboard {
            session_id: session_id.to_string(),
            text,
        })
        .await
    }

    /// Solicita resize do desktop remoto
    pub async fn resize(&self, session_id: &str, width: u16, height: u16) -> Result<()> {
        if !self.sessions.contains_key(session_id) {
            anyhow::bail!("Sessão RDP não encontrada: {}", session_id);
        }
        self.send_command(BridgeCommand::Resize {
            session_id: session_id.to_string(),
            width,
            height,
        })
        .await
    }

    /// Desconecta uma sessão
    pub async fn disconnect(&self, session_id: &str) -> Result<()> {
        self.sessions.remove(session_id);
        self.send_command(BridgeCommand::Disconnect {
            session_id: session_id.to_string(),
        })
        .await
    }
}

// ─── Event handler ───────────────────────────────────────────────────────────

fn handle_bridge_event(app: &AppHandle, event: BridgeEvent) {
    match event {
        BridgeEvent::Connected { session_id, width, height } => {
            tracing::info!("RDP sessão {} conectada ({}x{})", session_id, width, height);
            let _ = app.emit(
                &format!("rdp://resolution/{}", session_id),
                RdpResolutionEvent { width, height },
            );
        }
        BridgeEvent::Frame { session_id, x, y, width, height, format, data_b64 } => {
            let event = RdpFrameEvent {
                x,
                y,
                w: width,
                h: height,
                format,
                data: data_b64,
            };
            let _ = app.emit(&format!("rdp://frame/{}", session_id), event);
        }
        BridgeEvent::Disconnected { session_id, reason } => {
            tracing::info!("RDP sessão {} desconectada: {}", session_id, reason);
            let _ = app.emit(
                &format!("rdp://close/{}", session_id),
                reason,
            );
        }
        BridgeEvent::Error { message } => {
            tracing::error!("Erro do sidecar rdp-bridge: {}", message);
        }
        BridgeEvent::ClipboardReceived { session_id, text } => {
            let _ = app.emit(
                &format!("rdp://clipboard/{}", session_id),
                text,
            );
        }
        BridgeEvent::Resolution { session_id, width, height } => {
            tracing::info!("RDP sessão {} resize: {}x{}", session_id, width, height);
            let _ = app.emit(
                &format!("rdp://resolution/{}", session_id),
                RdpResolutionEvent { width, height },
            );
        }
    }
}
