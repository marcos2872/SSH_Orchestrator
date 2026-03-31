use crate::AppState;
use tauri::State;
use uuid::Uuid;

/// Establish an SSH session for a server.
///
/// Authentication priority (first that has a value wins):
///   1. Caller-supplied `ssh_key` (inline PEM) + optional `ssh_key_passphrase`
///   2. Saved encrypted SSH key from DB (decrypted via vault)
///   3. Caller-supplied `password`
///   4. Saved encrypted password from DB (decrypted via vault)
///
/// `cols` and `rows` set the initial PTY dimensions (defaults: 80×24).
#[tauri::command]
pub async fn ssh_connect(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    server_id: String,
    password: Option<String>,
    ssh_key: Option<String>,
    ssh_key_passphrase: Option<String>,
    session_id: String,
    cols: Option<u32>,
    rows: Option<u32>,
) -> Result<String, String> {
    let srv_uuid = Uuid::parse_str(&server_id).map_err(|e| e.to_string())?;

    // Load the full server row (we need the encrypted credentials)
    let row = sqlx::query_as::<_, crate::models::ServerRow>("SELECT * FROM servers WHERE id = ?")
        .bind(srv_uuid)
        .fetch_one(&state.db.pool)
        .await
        .map_err(|e| e.to_string())?;

    let host = row.host.clone();
    let port = row.port as u16;
    let username = row.username.clone();

    // ── Resolve SSH key ───────────────────────────────────────────────────────
    let resolved_key: Option<String> = match ssh_key.as_deref() {
        Some(k) if !k.is_empty() => Some(k.to_string()),
        _ => {
            // Try the saved encrypted key from DB
            match row.ssh_key_enc.as_deref() {
                Some(enc) => {
                    let plain = state.crypto.decrypt(enc).map_err(|e| e.to_string())?;
                    Some(plain)
                }
                None => None,
            }
        }
    };

    // ── Resolve passphrase for the key ────────────────────────────────────────
    let resolved_passphrase: Option<String> = match ssh_key_passphrase.as_deref() {
        Some(p) if !p.is_empty() => Some(p.to_string()),
        _ => {
            // If caller sent an inline key without passphrase, don't pull from DB
            // (inline key + DB passphrase don't belong together)
            if ssh_key.as_deref().map(|k| !k.is_empty()).unwrap_or(false) {
                None
            } else {
                match row.ssh_key_passphrase_enc.as_deref() {
                    Some(enc) => {
                        let plain = state.crypto.decrypt(enc).map_err(|e| e.to_string())?;
                        Some(plain)
                    }
                    None => None,
                }
            }
        }
    };

    // ── Resolve password (fallback when no key is available) ─────────────────
    let resolved_password: Option<String> = if resolved_key.is_none() {
        match password.as_deref() {
            Some(pw) if !pw.is_empty() => Some(pw.to_string()),
            _ => match row.password_enc.as_deref() {
                Some(enc) => {
                    let plain = state.crypto.decrypt(enc).map_err(|e| e.to_string())?;
                    Some(plain)
                }
                None => None,
            },
        }
    } else {
        None
    };

    // At least one credential must be available
    if resolved_key.is_none() && resolved_password.is_none() {
        return Err(
            "Nenhuma credencial disponível. Forneça uma senha ou chave SSH.".to_string(),
        );
    }

    state
        .ssh
        .connect(
            app,
            &host,
            port,
            &username,
            resolved_password.as_deref(),
            resolved_key.as_deref(),
            resolved_passphrase.as_deref(),
            session_id,
            cols,
            rows,
        )
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ssh_write(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    state
        .ssh
        .write(&session_id, &data)
        .await
        .map_err(|e| e.to_string())
}

/// Notify the remote PTY of a terminal resize (cols × rows).
#[tauri::command]
pub async fn ssh_resize(
    state: State<'_, AppState>,
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    state
        .ssh
        .resize(&session_id, cols, rows)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ssh_disconnect(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    state
        .ssh
        .disconnect(&session_id)
        .await
        .map_err(|e| e.to_string())
}
