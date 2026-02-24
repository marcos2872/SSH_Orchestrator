pub mod crdt;
pub mod git_ops;
pub mod repo;
pub mod merge;

use crate::AppState;
use merge::{CRDTServer, CRDTWorkspace};
use std::fs;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub async fn pull_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
    _workspace_id: String,
) -> Result<(), String> {
    
    let _lock = state.sync_lock.try_lock().map_err(|_| "Sincronização já em andamento")?;

    let token = {
        let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let token_path = app_dir.join("github_token.enc");
        let encrypted = fs::read_to_string(&token_path).map_err(|_| "Sessão não encontrada")?;
        state.crypto.decrypt(&encrypted).map_err(|_| "Token inválido")?
    };

    let repo_info = repo::ensure_sync_repo_exists(&token)
        .await
        .map_err(|e| e.to_string())?;

    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let sync_service = git_ops::GitSyncService::new(&app_dir);
    let git_repo = sync_service
        .init_repo(&repo_info.clone_url, &token)
        .map_err(|e| e.to_string())?;

    // Pull from remote (this will do a hard reset if remote is different, overwriting local JSONs)
    sync_service.pull(&git_repo, &token).map_err(|e| e.to_string())?;

    let workspaces_path = app_dir.join("sync_repo/workspaces.json");
    let servers_path = app_dir.join("sync_repo/servers.json");

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

    // Merge logic combining local SQLite with the recently pulled and parsed remote JSONs.
    // merge_workspaces and merge_servers update the SQLite db.
    let _ = merge::merge_workspaces(&state, remote_workspaces)
        .await
        .map_err(|e| e.to_string())?;

    let _ = merge::merge_servers(&state, remote_servers)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn push_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
    _workspace_id: String,
) -> Result<(), String> {
    
    let _lock = state.sync_lock.try_lock().map_err(|_| "Sincronização já em andamento")?;

    let token = {
        let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let token_path = app_dir.join("github_token.enc");
        let encrypted = fs::read_to_string(&token_path).map_err(|_| "Sessão não encontrada")?;
        state.crypto.decrypt(&encrypted).map_err(|_| "Token inválido")?
    };

    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let sync_service = git_ops::GitSyncService::new(&app_dir);
    
    let repo_info = repo::ensure_sync_repo_exists(&token)
        .await
        .map_err(|e| e.to_string())?;

    let git_repo = sync_service
        .init_repo(&repo_info.clone_url, &token)
        .map_err(|e| e.to_string())?;

    // To push, we MUST do a pull first just to ensure we're at the top of the commit tree.
    // A push directly would be rejected by GitHub if not fast-forward.
    // So we fetch, and if there are changes, we do a hard reset to the remote's head.
    sync_service.pull(&git_repo, &token).map_err(|e| e.to_string())?;

    // Now, we regenerate the JSON files strictly from the local database,
    // overwriting whatever we just pulled if necessary.
    
    // We call get_local_workspaces and get_local_servers to strictly serialize the local DB
    // instead of calling merge routines which would mistakenly delete records.
    let resolved_workspaces = merge::get_local_workspaces(&state)
        .await
        .map_err(|e| e.to_string())?;

    let resolved_servers = merge::get_local_servers(&state)
        .await
        .map_err(|e| e.to_string())?;

    let workspaces_path = app_dir.join("sync_repo/workspaces.json");
    let servers_path = app_dir.join("sync_repo/servers.json");

    let workspaces_json = serde_json::to_string_pretty(&resolved_workspaces).map_err(|e| e.to_string())?;
    let servers_json = serde_json::to_string_pretty(&resolved_servers).map_err(|e| e.to_string())?;

    fs::write(&workspaces_path, workspaces_json).map_err(|e| e.to_string())?;
    fs::write(&servers_path, servers_json).map_err(|e| e.to_string())?;

    // Export current local vault config
    match state.crypto.get_vault_payload() {
        Ok(payload) => {
            let vault_sync_path = app_dir.join("sync_repo/vault_sync.json");
            let _ = fs::write(&vault_sync_path, payload);
        },
        Err(e) => {
            tracing::warn!("Local vault not configured or exported: {}", e);
        }
    }

    // Push changes
    let commit_message = format!("Forced Push from SSH Config Sync at {}", chrono::Utc::now().to_rfc3339());
    sync_service
        .push(&git_repo, &token, &commit_message)
        .map_err(|e| format!("Failed to push: {}", e))?;

    Ok(())
}
