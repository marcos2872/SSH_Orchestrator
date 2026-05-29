//! rdp-bridge: Standalone RDP client sidecar.
//!
//! Protocolo JSON-over-stdio:
//! - Stdin: comandos (connect, disconnect, mouse, key, clipboard, resize)
//! - Stdout: eventos (connected, frame, disconnected, error)
//!
//! Cada linha é um objeto JSON completo (newline-delimited JSON).

mod protocol;
mod session;

use anyhow::Result;
use tokio::io::{self, AsyncBufReadExt, BufReader};
use tokio::sync::mpsc;
use tracing::{error, info};

use protocol::{Command, Event};

#[tokio::main]
async fn main() -> Result<()> {
    // Logging vai para stderr (stdout é reservado para protocolo)
    // RUST_LOG (se setado) tem precedência; senão default rdp_bridge=info
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("rdp_bridge=info"));
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(env_filter)
        .init();

    info!("rdp-bridge iniciando");

    // Canal para enviar eventos de volta ao parent process
    let (event_tx, mut event_rx) = mpsc::unbounded_channel::<Event>();

    // Task que escreve eventos em stdout
    let writer_handle = tokio::spawn(async move {
        use tokio::io::AsyncWriteExt;
        let mut stdout = io::stdout();
        while let Some(event) = event_rx.recv().await {
            match serde_json::to_string(&event) {
                Ok(json) => {
                    let line = format!("{}\n", json);
                    if stdout.write_all(line.as_bytes()).await.is_err() {
                        break;
                    }
                    let _ = stdout.flush().await;
                }
                Err(e) => {
                    error!("Falha ao serializar evento: {}", e);
                }
            }
        }
    });

    // Gerenciador de sessão
    let mut session_manager = session::SessionManager::new(event_tx.clone());

    // Lê comandos de stdin
    let stdin = BufReader::new(io::stdin());
    let mut lines = stdin.lines();

    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() {
            continue;
        }

        match serde_json::from_str::<Command>(&line) {
            Ok(cmd) => {
                if let Err(e) = session_manager.handle_command(cmd).await {
                    let _ = event_tx.send(Event::Error {
                        message: e.to_string(),
                    });
                }
            }
            Err(e) => {
                let _ = event_tx.send(Event::Error {
                    message: format!("Comando inválido: {}", e),
                });
            }
        }
    }

    info!("stdin fechado, encerrando rdp-bridge");
    session_manager.disconnect_all().await;
    drop(event_tx);
    let _ = writer_handle.await;

    Ok(())
}
