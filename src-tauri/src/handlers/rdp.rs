use crate::AppState;
use tauri::State;
use uuid::Uuid;

/// Establish an RDP session for a server.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
#[tracing::instrument(skip(state, app, password))]
pub async fn rdp_connect(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    server_id: String,
    password: Option<String>,
    session_id: String,
    width: u16,
    height: u16,
    domain: Option<String>,
) -> Result<String, String> {
    let srv_uuid = Uuid::parse_str(&server_id).map_err(|e| e.to_string())?;

    // Load server from DB
    let row = sqlx::query_as::<_, crate::models::ServerRow>("SELECT * FROM servers WHERE id = ?")
        .bind(srv_uuid)
        .fetch_one(&state.db.pool)
        .await
        .map_err(|e| e.to_string())?;

    let host = row.host.clone();
    // Porta RDP padrão é 3389 — não usar a porta SSH do servidor
    let rdp_port: u16 = 3389;
    let username = row.username.clone();

    // Resolve password: caller-provided or from encrypted DB
    let resolved_password = match password.as_deref() {
        Some(pw) if !pw.is_empty() => pw.to_string(),
        _ => match row.password_enc.as_deref() {
            Some(enc) => state.crypto.decrypt(enc).map_err(|e| e.to_string())?,
            None => {
                return Err("Nenhuma senha disponível para conexão RDP.".to_string());
            }
        },
    };

    state
        .rdp
        .connect(
            app,
            &host,
            rdp_port,
            &username,
            &resolved_password,
            domain.as_deref(),
            session_id,
            width,
            height,
        )
        .await
        .map_err(|e| e.to_string())
}

/// Disconnect an RDP session.
#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn rdp_disconnect(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    state.rdp.disconnect(&session_id).await.map_err(|e| e.to_string())
}

/// Send mouse event to RDP session.
/// `button`: 0=none/move, 1=left, 2=right, 3=middle
/// `flags`: RDP MouseEventFlags bitmask (see ironrdp docs)
///   - 0x0800 = MOUSE_MOVE
///   - 0x8000 = DOWN (button press)
///   - 0x0000 = UP (button release, when combined with button)
///   - 0x0100 = WHEEL_NEGATIVE
///   - 0x0200 = VERTICAL_WHEEL
#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn rdp_send_mouse(
    state: State<'_, AppState>,
    session_id: String,
    x: u16,
    y: u16,
    button: u8,
    flags: u16,
) -> Result<(), String> {
    state
        .rdp
        .send_mouse(&session_id, x, y, button, flags)
        .await
        .map_err(|e| e.to_string())
}

/// Send keyboard event to RDP session.
/// `scancode`: Windows scan code (e.g., 0x1E = 'A')
/// `is_down`: true for keydown, false for keyup
/// `is_extended`: true for extended keys (e.g., right Ctrl, arrows, etc.)
#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn rdp_send_key(
    state: State<'_, AppState>,
    session_id: String,
    scancode: u16,
    is_down: bool,
    is_extended: bool,
) -> Result<(), String> {
    state
        .rdp
        .send_key(&session_id, scancode, is_down, is_extended)
        .await
        .map_err(|e| e.to_string())
}

/// Send unicode character event to RDP session.
#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn rdp_send_unicode(
    state: State<'_, AppState>,
    session_id: String,
    unicode: u16,
    is_down: bool,
) -> Result<(), String> {
    state
        .rdp
        .send_unicode_key(&session_id, unicode, is_down)
        .await
        .map_err(|e| e.to_string())
}

/// Send clipboard text to the remote RDP session (local → remote).
#[tauri::command]
#[tracing::instrument(skip(state, text))]
pub async fn rdp_clipboard_set(
    state: State<'_, AppState>,
    session_id: String,
    text: String,
) -> Result<(), String> {
    state
        .rdp
        .send_clipboard(&session_id, text)
        .await
        .map_err(|e| e.to_string())
}

/// Request display resize for RDP session.
#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn rdp_resize(
    state: State<'_, AppState>,
    session_id: String,
    width: u16,
    height: u16,
) -> Result<(), String> {
    state
        .rdp
        .resize(&session_id, width, height)
        .await
        .map_err(|e| e.to_string())
}
