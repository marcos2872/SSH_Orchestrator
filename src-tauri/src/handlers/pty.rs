use crate::AppState;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use tauri::State;

/// Spawn a local shell in a PTY. Output is delivered via `pty://data/{session_id}` events.
/// When the shell exits, a `pty://close/{session_id}` event is emitted.
#[tauri::command]
pub fn pty_spawn(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    session_id: String,
    cols: Option<u32>,
    rows: Option<u32>,
    shell: Option<String>,
) -> Result<String, String> {
    let c = cols.unwrap_or(80).min(u16::MAX as u32) as u16;
    let r = rows.unwrap_or(24).min(u16::MAX as u32) as u16;

    state
        .pty
        .spawn(app, session_id, c, r, shell)
        .map_err(|e| e.to_string())
}

/// Send raw bytes (base64-encoded) to the local shell's stdin.
#[tauri::command]
pub fn pty_write(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let bytes = B64.decode(&data).map_err(|e| e.to_string())?;
    state
        .pty
        .write(&session_id, &bytes)
        .map_err(|e| e.to_string())
}

/// Notify the local PTY of a terminal resize (cols × rows).
#[tauri::command]
pub fn pty_resize(
    state: State<'_, AppState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    let c = cols.min(u16::MAX as u32) as u16;
    let r = rows.min(u16::MAX as u32) as u16;
    state
        .pty
        .resize(&session_id, c, r)
        .map_err(|e| e.to_string())
}

/// Kill the local shell and clean up the session.
#[tauri::command]
pub fn pty_kill(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    state.pty.kill(&session_id).map_err(|e| e.to_string())
}
