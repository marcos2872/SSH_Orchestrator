use crate::AppState;
use tauri::State;
use uuid::Uuid;

/// Establish an SSH session for a server. If `password` is None and the server
/// has a saved password, it is automatically decrypted and used.
#[tauri::command]
pub async fn ssh_connect(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    server_id: String,
    password: Option<String>,
) -> Result<String, String> {
    let srv_uuid = Uuid::parse_str(&server_id).map_err(|e| e.to_string())?;

    let row = sqlx::query_as::<_, crate::models::ServerRow>(
        "SELECT * FROM servers WHERE id = ?",
    )
    .bind(srv_uuid)
    .fetch_one(&state.db.pool)
    .await
    .map_err(|e| e.to_string())?;

    let server = row.into_server();

    // Resolve the password: prefer caller-supplied, then saved password
    let resolved_password = match password.as_deref() {
        Some(pw) if !pw.is_empty() => pw.to_string(),
        _ => {
            // Try to load the saved encrypted password
            let enc_row: Option<(Option<String>,)> =
                sqlx::query_as("SELECT password_enc FROM servers WHERE id = ?")
                    .bind(srv_uuid)
                    .fetch_optional(&state.db.pool)
                    .await
                    .map_err(|e| e.to_string())?;

            match enc_row.and_then(|(enc,)| enc) {
                Some(enc) => state.crypto.decrypt(&enc).map_err(|e| e.to_string())?,
                None => return Err("Nenhuma senha fornecida ou salva para este servidor.".into()),
            }
        }
    };

    state
        .ssh
        .connect(app, &server.host, server.port, &server.username, &resolved_password)
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

#[tauri::command]
pub async fn ssh_disconnect(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    state
        .ssh
        .disconnect(&session_id)
        .await
        .map_err(|e| e.to_string())
}
