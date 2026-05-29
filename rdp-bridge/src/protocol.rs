//! Definições do protocolo JSON-over-stdio entre Tauri e rdp-bridge.

use serde::{Deserialize, Serialize};

/// Comandos enviados pelo Tauri (stdin do sidecar)
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum Command {
    #[serde(rename = "connect")]
    Connect {
        session_id: String,
        host: String,
        port: u16,
        username: String,
        password: String,
        width: u16,
        height: u16,
        /// Usar TLS (padrão: true para xrdp)
        #[serde(default = "default_true")]
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

/// Eventos emitidos pelo rdp-bridge (stdout → Tauri)
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type")]
pub enum Event {
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
        /// Formato dos dados: "jpeg" ou "rgba"
        format: String,
        /// Bitmap codificado em base64 (JPEG ou RGBA raw conforme format)
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
}

fn default_true() -> bool {
    true
}
