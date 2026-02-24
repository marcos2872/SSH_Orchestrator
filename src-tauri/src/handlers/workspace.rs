use crate::AppState;
use crate::models::Workspace;
use chrono::Utc;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn get_workspaces(state: State<'_, AppState>) -> Result<Vec<Workspace>, String> {
    sqlx::query_as::<_, Workspace>("SELECT * FROM workspaces ORDER BY name")
        .fetch_all(&state.db.pool)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_workspace(
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
pub async fn update_workspace(
    state: State<'_, AppState>,
    id: String,
    name: String,
    color: String,
    sync_enabled: Option<bool>,
) -> Result<(), String> {
    let ws_id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let now = Utc::now();
    
    if let Some(sync) = sync_enabled {
        sqlx::query("UPDATE workspaces SET name = ?, color = ?, sync_enabled = ?, updated_at = ? WHERE id = ?")
            .bind(&name)
            .bind(&color)
            .bind(sync)
            .bind(&now)
            .bind(ws_id)
            .execute(&state.db.pool)
            .await
            .map_err(|e| e.to_string())?;
    } else {
        sqlx::query("UPDATE workspaces SET name = ?, color = ?, updated_at = ? WHERE id = ?")
            .bind(&name)
            .bind(&color)
            .bind(&now)
            .bind(ws_id)
            .execute(&state.db.pool)
            .await
            .map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

#[tauri::command]
pub async fn delete_workspace(state: State<'_, AppState>, id: String) -> Result<(), String> {
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
