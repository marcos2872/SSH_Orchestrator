use crate::services::db::DbService;
use crate::models::Workspace;
use tauri::{Manager, State};
use uuid::Uuid;
use chrono::Utc;

pub struct AppState {
    pub db: DbService,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle();
            tauri::async_runtime::block_on(async move {
                let db = DbService::new(&handle).await.expect("failed to init db");
                handle.manage(AppState { db });
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
            delete_server
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
async fn get_workspaces(state: State<'_, AppState>) -> Result<Vec<Workspace>, String> {
    sqlx::query_as::<_, Workspace>("SELECT * FROM workspaces ORDER BY name")
        .fetch_all(&state.db.pool)
        .await
        .map_err(|e: sqlx::Error| e.to_string())
}

#[tauri::command]
async fn create_workspace(
    state: State<'_, AppState>,
    name: String,
    color: String
) -> Result<Workspace, String> {
    let workspace = Workspace {
        id: Uuid::new_v4(),
        name,
        sync_enabled: false,
        local_only: false,
        color,
        updated_at: Utc::now(),
    };

    sqlx::query("INSERT INTO workspaces (id, name, sync_enabled, local_only, color, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(&workspace.id)
        .bind(&workspace.name)
        .bind(workspace.sync_enabled)
        .bind(workspace.local_only)
        .bind(&workspace.color)
        .bind(&workspace.updated_at)
        .execute(&state.db.pool)
        .await
        .map_err(|e: sqlx::Error| e.to_string())?;

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
        .map_err(|e: sqlx::Error| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn delete_workspace(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let ws_id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    // Delete associated servers first
    sqlx::query("DELETE FROM servers WHERE workspace_id = ?")
        .bind(ws_id)
        .execute(&state.db.pool)
        .await
        .map_err(|e: sqlx::Error| e.to_string())?;
    // Then delete the workspace
    sqlx::query("DELETE FROM workspaces WHERE id = ?")
        .bind(ws_id)
        .execute(&state.db.pool)
        .await
        .map_err(|e: sqlx::Error| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn get_servers(
    state: State<'_, AppState>,
    workspace_id: String
) -> Result<Vec<crate::models::Server>, String> {
    let ws_uuid = Uuid::parse_str(&workspace_id).map_err(|e| e.to_string())?;
    let rows = sqlx::query_as::<_, crate::models::ServerRow>("SELECT * FROM servers WHERE workspace_id = ?")
        .bind(ws_uuid)
        .fetch_all(&state.db.pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows.into_iter().map(|r| r.into_server()).collect())
}

#[tauri::command]
async fn create_server(
    state: State<'_, AppState>,
    workspace_id: String,
    name: String,
    host: String,
    port: u16,
    username: String
) -> Result<crate::models::Server, String> {
    let server = crate::models::Server {
        id: Uuid::new_v4(),
        workspace_id: Uuid::parse_str(&workspace_id).map_err(|e| e.to_string())?,
        name,
        host,
        port,
        username,
        tags: vec![],
        folder_color: None,
    };

    sqlx::query("INSERT INTO servers (id, workspace_id, name, host, port, username, tags) VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(&server.id)
        .bind(&server.workspace_id)
        .bind(&server.name)
        .bind(&server.host)
        .bind(server.port)
        .bind(&server.username)
        .bind(serde_json::to_string(&server.tags).unwrap())
        .execute(&state.db.pool)
        .await
        .map_err(|e: sqlx::Error| e.to_string())?;

    Ok(server)
}

#[tauri::command]
async fn update_server(
    state: State<'_, AppState>,
    id: String,
    name: String,
    host: String,
    port: u16,
    username: String,
) -> Result<(), String> {
    let srv_id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    sqlx::query("UPDATE servers SET name = ?, host = ?, port = ?, username = ? WHERE id = ?")
        .bind(&name)
        .bind(&host)
        .bind(port)
        .bind(&username)
        .bind(srv_id)
        .execute(&state.db.pool)
        .await
        .map_err(|e: sqlx::Error| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn delete_server(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let srv_id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM servers WHERE id = ?")
        .bind(srv_id)
        .execute(&state.db.pool)
        .await
        .map_err(|e: sqlx::Error| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

pub mod models;
pub mod services;
pub mod sync;
