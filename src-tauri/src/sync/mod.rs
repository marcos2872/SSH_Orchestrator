pub mod crdt;
pub mod git_ops;
pub mod repo;
pub mod merge;

use crate::AppState;
use merge::{CRDTServer, CRDTWorkspace};
use std::fs;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub async fn sync_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
    _workspace_id: String,
) -> Result<(), String> {
    // 1. Get the GitHub Token
    let token = {
        let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let token_path = app_dir.join("github_token.enc");
        let encrypted = fs::read_to_string(&token_path).map_err(|_| "Sessão não encontrada")?;
        state.crypto.decrypt(&encrypted).map_err(|_| "Token inválido")?
    };

    // 2. Ensure repository exists and get URL
    let repo_info = repo::ensure_sync_repo_exists(&token)
        .await
        .map_err(|e| e.to_string())?;

    // 3. Clone or Open the Sync Repo
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let sync_service = git_ops::GitSyncService::new(&app_dir);
    let git_repo = sync_service
        .init_repo(&repo_info.clone_url, &token)
        .map_err(|e| e.to_string())?;

    // 4. Pull latest changes
    sync_service.pull(&git_repo, &token).map_err(|e| e.to_string())?;

    let workspaces_path = app_dir.join("sync_repo/workspaces.json");
    let servers_path = app_dir.join("sync_repo/servers.json");

    // Read remote states (fallback to empty vec if files don't exist yet)
    let remote_workspaces: Vec<CRDTWorkspace> = if workspaces_path.exists() {
        let json_str = fs::read_to_string(&workspaces_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&json_str).unwrap_or_default()
    } else {
        Vec::new()
    };

    let remote_servers: Vec<CRDTServer> = if servers_path.exists() {
        let json_str = fs::read_to_string(&servers_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&json_str).unwrap_or_default()
    } else {
        Vec::new()
    };

    // 5. Merge logic
    let resolved_workspaces = merge::merge_workspaces(&state, remote_workspaces)
        .await
        .map_err(|e| e.to_string())?;

    let resolved_servers = merge::merge_servers(&state, remote_servers)
        .await
        .map_err(|e| e.to_string())?;

    // Filter to only sync the actual workspace requested (and keep siblings if any)
    // Actually, in Phase 0.3 MVP, we'll sync the whole DB to the JSON for simplicity
    
    // 6. Save combined state to repo JSON files
    let workspaces_json = serde_json::to_string_pretty(&resolved_workspaces).map_err(|e| e.to_string())?;
    let servers_json = serde_json::to_string_pretty(&resolved_servers).map_err(|e| e.to_string())?;

    fs::write(&workspaces_path, workspaces_json).map_err(|e| e.to_string())?;
    fs::write(&servers_path, servers_json).map_err(|e| e.to_string())?;

    // 7. Push changes if anything was updated
    let commit_message = format!("Sync from SSH Config Sync at {}", chrono::Utc::now().to_rfc3339());
    sync_service
        .push(&git_repo, &token, &commit_message)
        .map_err(|e| format!("Failed to push: {}", e))?;

    Ok(())
}
