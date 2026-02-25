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
    provided_token: Option<String>,
) -> Result<(), String> {
    
    let _lock = state.sync_lock.try_lock().map_err(|_| "Sincronização já em andamento")?;

    let token = if let Some(t) = provided_token {
        t
    } else {
        let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let token_path = app_dir.join("github_token.enc");
        let encrypted = fs::read_to_string(&token_path).map_err(|_| "Sessão não encontrada")?;
        state.crypto.decrypt(&encrypted).map_err(|_| "Token inválido ou cofre bloqueado")?
    };

    tracing::info!("Starting pull_workspace...");
    let repo_info = repo::ensure_sync_repo_exists(&token)
        .await
        .map_err(|e| {
            tracing::error!("Failed to ensure sync repo exists in pull: {}", e);
            e.to_string()
        })?;

    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let sync_repo_dir = app_dir.join("sync_repo");
    tracing::info!("pull_workspace: sync_repo_dir exists: {}", sync_repo_dir.exists());

    let sync_service = git_ops::GitSyncService::new(&app_dir);
    
    tracing::info!("pull_workspace: Initializing/Opening sync repo...");
    let git_repo = sync_service
        .init_repo(&repo_info.clone_url, &token)
        .map_err(|e| {
            tracing::error!("pull_workspace: Failed to init/clone repo: {}", e);
            e.to_string()
        })?;

    tracing::info!("pull_workspace: Repo initialized. Pulling...");
    // Pull from remote (this will do a hard reset if remote is different, overwriting local JSONs)
    sync_service.pull(&git_repo, &token).map_err(|e| {
        tracing::error!("pull_workspace: Failed to pull: {}", e);
        e.to_string()
    })?;

    tracing::info!("pull_workspace: Pull finished. Checking for vault_sync.json...");
    let vault_sync_path = sync_repo_dir.join("vault_sync.json");
    tracing::info!("pull_workspace: vault_sync.json exists: {}", vault_sync_path.exists());

    let vault_sync_path = app_dir.join("sync_repo/vault_sync.json");
    if vault_sync_path.exists() {
        tracing::info!("Synced vault found at {:?}", vault_sync_path);
    } else {
        tracing::info!("No synced vault found at {:?}", vault_sync_path);
    }

    let workspaces_dir = app_dir.join("sync_repo/workspaces");
    let mut remote_workspaces = Vec::new();
    let mut remote_servers = Vec::new();
    let mut pulled_workspace_ids = std::collections::HashSet::new();

    if workspaces_dir.exists() {
        if let Ok(entries) = fs::read_dir(&workspaces_dir) {
            for entry in entries.flatten() {
                if let Ok(ft) = entry.file_type() {
                    if ft.is_file() {
                        if entry.path().extension().and_then(|ext| ext.to_str()) == Some("json") {
                            if let Ok(json_str) = fs::read_to_string(entry.path()) {
                                if let Ok(mut sync_data) = serde_json::from_str::<merge::WorkspaceSyncData>(&json_str) {
                                    pulled_workspace_ids.insert(sync_data.workspace.id.clone());
                                    remote_workspaces.push(sync_data.workspace);
                                    remote_servers.append(&mut sync_data.servers);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Merge logic combining local SQLite with the recently pulled and parsed remote JSONs.
    // merge_workspaces and merge_servers update the SQLite db.
    let _ = merge::merge_workspaces(&state, remote_workspaces)
        .await
        .map_err(|e| e.to_string())?;

    let _ = merge::merge_servers(&state, remote_servers, &pulled_workspace_ids)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn push_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
    _workspace_id: String,
    provided_token: Option<String>,
) -> Result<(), String> {
    
    let _lock = state.sync_lock.try_lock().map_err(|_| "Sincronização já em andamento")?;

    let token = if let Some(t) = provided_token {
        t
    } else {
        let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let token_path = app_dir.join("github_token.enc");
        let encrypted = fs::read_to_string(&token_path).map_err(|_| "Sessão não encontrada")?;
        state.crypto.decrypt(&encrypted).map_err(|_| "Token inválido ou cofre bloqueado")?
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

    let workspaces_dir = app_dir.join("sync_repo/workspaces");
    if !workspaces_dir.exists() {
        fs::create_dir_all(&workspaces_dir).map_err(|e| e.to_string())?;
    }

    // Cleanup legacy files if present
    let legacy_workspaces_path = app_dir.join("sync_repo/workspaces.json");
    let legacy_servers_path = app_dir.join("sync_repo/servers.json");
    if legacy_workspaces_path.exists() { let _ = fs::remove_file(&legacy_workspaces_path); }
    if legacy_servers_path.exists() { let _ = fs::remove_file(&legacy_servers_path); }

    for workspace in resolved_workspaces {
        let file_path = workspaces_dir.join(format!("{}.json", workspace.id));
        
        if !workspace.sync_enabled || workspace.deleted {
            if file_path.exists() {
                let _ = fs::remove_file(&file_path);
            }
        } else {
            let mut ws_servers = Vec::new();
            for server in &resolved_servers {
                if server.workspace_id == workspace.id && !server.deleted {
                    ws_servers.push(server.clone());
                }
            }
            
            let sync_data = merge::WorkspaceSyncData {
                workspace,
                servers: ws_servers,
            };
            
            let json_str = serde_json::to_string_pretty(&sync_data).map_err(|e| e.to_string())?;
            fs::write(&file_path, json_str).map_err(|e| e.to_string())?;
        }
    }

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
