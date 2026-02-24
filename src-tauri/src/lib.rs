use crate::models::Workspace;
use crate::services::crypto::CryptoService;
use crate::services::db::DbService;
use crate::services::ssh::SshService;
use tauri::{Manager, State};
use uuid::Uuid;
use chrono::Utc;

pub struct AppState {
    pub db: DbService,
    pub ssh: SshService,
    pub crypto: CryptoService,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle();
            tauri::async_runtime::block_on(async move {
                let app_dir = handle
                    .path()
                    .app_data_dir()
                    .expect("failed to get app data dir");
                std::fs::create_dir_all(&app_dir).expect("failed to create app data dir");

                let db = DbService::new(&handle).await.expect("failed to init db");
                let crypto = CryptoService::new(&app_dir).expect("failed to init crypto");

                handle.manage(AppState {
                    db,
                    ssh: SshService::new(),
                    crypto,
                });
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_workspaces,
            create_workspace,
            update_workspace,
            delete_workspace,
            get_servers,
            create_server,
            update_server,
            delete_server,
            get_server_password,
            ssh_connect,
            ssh_write,
            ssh_disconnect,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ─── Workspace commands ───────────────────────────────────────────────────────

#[tauri::command]
async fn get_workspaces(state: State<'_, AppState>) -> Result<Vec<Workspace>, String> {
    sqlx::query_as::<_, Workspace>("SELECT * FROM workspaces ORDER BY name")
        .fetch_all(&state.db.pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn create_workspace(
    state: State<'_, AppState>,
    name: String,
    color: String,
) -> Result<Workspace, String> {
    let workspace = Workspace {
        id: Uuid::new_v4(),
        name,
        sync_enabled: false,
        local_only: false,
        color,
        updated_at: Utc::now(),
    };

    sqlx::query(
        "INSERT INTO workspaces (id, name, sync_enabled, local_only, color, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(&workspace.id)
    .bind(&workspace.name)
    .bind(workspace.sync_enabled)
    .bind(workspace.local_only)
    .bind(&workspace.color)
    .bind(&workspace.updated_at)
    .execute(&state.db.pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(workspace)
}

#[tauri::command]
async fn update_workspace(
    state: State<'_, AppState>,
    id: String,
    name: String,
    color: String,
) -> Result<(), String> {
    let ws_id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let now = Utc::now();
    sqlx::query("UPDATE workspaces SET name = ?, color = ?, updated_at = ? WHERE id = ?")
        .bind(&name)
        .bind(&color)
        .bind(&now)
        .bind(ws_id)
        .execute(&state.db.pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn delete_workspace(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let ws_id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM servers WHERE workspace_id = ?")
        .bind(ws_id)
        .execute(&state.db.pool)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM workspaces WHERE id = ?")
        .bind(ws_id)
        .execute(&state.db.pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ─── Server commands ──────────────────────────────────────────────────────────

#[tauri::command]
async fn get_servers(
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
async fn create_server(
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
async fn update_server(
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
async fn delete_server(state: State<'_, AppState>, id: String) -> Result<(), String> {
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
async fn get_server_password(
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

// ─── SSH commands ─────────────────────────────────────────────────────────────

/// Establish an SSH session for a server. If `password` is None and the server
/// has a saved password, it is automatically decrypted and used.
#[tauri::command]
async fn ssh_connect(
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
async fn ssh_write(
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
async fn ssh_disconnect(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    state
        .ssh
        .disconnect(&session_id)
        .await
        .map_err(|e| e.to_string())
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

pub mod models;
pub mod services;
pub mod sync;
