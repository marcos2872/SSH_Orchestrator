use crate::AppState;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn get_servers(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<crate::models::Server>, String> {
    let ws_uuid = Uuid::parse_str(&workspace_id).map_err(|e| e.to_string())?;
    let rows =
        sqlx::query_as::<_, crate::models::ServerRow>("SELECT * FROM servers WHERE workspace_id = ?")
            .bind(ws_uuid)
            .fetch_all(&state.db.pool)
            .await
            .map_err(|e| e.to_string())?;

    Ok(rows.into_iter().map(|r| r.into_server()).collect())
}

/// Create a server. If `password` is Some and `save_password` is true, encrypt
/// and persist it. The raw password is NEVER stored.
#[tauri::command]
pub async fn create_server(
    state: State<'_, AppState>,
    workspace_id: String,
    name: String,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    save_password: bool,
) -> Result<crate::models::Server, String> {
    let password_enc: Option<String> = if save_password {
        match password.as_deref() {
            Some(pw) if !pw.is_empty() => {
                Some(state.crypto.encrypt(pw).map_err(|e| e.to_string())?)
            }
            _ => None,
        }
    } else {
        None
    };

    let server = crate::models::Server {
        id: Uuid::new_v4(),
        workspace_id: Uuid::parse_str(&workspace_id).map_err(|e| e.to_string())?,
        name,
        host,
        port,
        username,
        tags: vec![],
        folder_color: None,
        has_saved_password: password_enc.is_some(),
    };

    sqlx::query(
        "INSERT INTO servers (id, workspace_id, name, host, port, username, tags, password_enc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&server.id)
    .bind(&server.workspace_id)
    .bind(&server.name)
    .bind(&server.host)
    .bind(server.port)
    .bind(&server.username)
    .bind(serde_json::to_string(&server.tags).unwrap())
    .bind(&password_enc)
    .execute(&state.db.pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(server)
}

/// Update server metadata + optionally rotate the saved password.
#[tauri::command]
pub async fn update_server(
    state: State<'_, AppState>,
    id: String,
    name: String,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    save_password: bool,
) -> Result<(), String> {
    let srv_id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;

    let password_enc: Option<String> = if save_password {
        match password.as_deref() {
            Some(pw) if !pw.is_empty() => {
                Some(state.crypto.encrypt(pw).map_err(|e| e.to_string())?)
            }
            _ => None,
        }
    } else {
        None
    };

    sqlx::query(
        "UPDATE servers SET name = ?, host = ?, port = ?, username = ?, password_enc = ? WHERE id = ?",
    )
    .bind(&name)
    .bind(&host)
    .bind(port)
    .bind(&username)
    .bind(&password_enc)
    .bind(srv_id)
    .execute(&state.db.pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn delete_server(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let srv_id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM servers WHERE id = ?")
        .bind(srv_id)
        .execute(&state.db.pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Decrypt and return the saved password for a server. Used by the Terminal
/// to auto-fill the SSH password prompt without exposing it to JS state.
#[tauri::command]
pub async fn get_server_password(
    state: State<'_, AppState>,
    server_id: String,
) -> Result<Option<String>, String> {
    let srv_id = Uuid::parse_str(&server_id).map_err(|e| e.to_string())?;
    let row: Option<(Option<String>,)> =
        sqlx::query_as("SELECT password_enc FROM servers WHERE id = ?")
            .bind(srv_id)
            .fetch_optional(&state.db.pool)
            .await
            .map_err(|e| e.to_string())?;

    match row.and_then(|(enc,)| enc) {
        Some(enc) => {
            let plain = state.crypto.decrypt(&enc).map_err(|e| e.to_string())?;
            Ok(Some(plain))
        }
        None => Ok(None),
    }
}
