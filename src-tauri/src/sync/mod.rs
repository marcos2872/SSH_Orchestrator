pub mod crdt;
pub mod git_ops;
pub mod merge;
pub mod repo;

use crate::AppState;
use std::fs;
use tauri::{AppHandle, Manager, State};

/// Parse all `{id}.json` files from the `sync_repo/workspaces/` directory into
/// vectors of remote workspaces and servers, and collect the workspace IDs that
/// were successfully parsed.
fn read_remote_jsons(
    workspaces_dir: &std::path::Path,
) -> (
    Vec<merge::CRDTWorkspace>,
    Vec<merge::CRDTServer>,
    std::collections::HashSet<String>,
) {
    let mut remote_workspaces = Vec::new();
    let mut remote_servers = Vec::new();
    let mut pulled_workspace_ids = std::collections::HashSet::new();

    if !workspaces_dir.exists() {
        return (remote_workspaces, remote_servers, pulled_workspace_ids);
    }

    let entries = match fs::read_dir(workspaces_dir) {
        Ok(e) => e,
        Err(err) => {
            tracing::warn!("Failed to read workspaces dir: {}", err);
            return (remote_workspaces, remote_servers, pulled_workspace_ids);
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let json_str = match fs::read_to_string(&path) {
            Ok(s) => s,
            Err(err) => {
                tracing::warn!("Failed to read {:?}: {}", path, err);
                continue;
            }
        };
        match serde_json::from_str::<merge::WorkspaceSyncData>(&json_str) {
            Ok(mut sync_data) => {
                pulled_workspace_ids.insert(sync_data.workspace.id.clone());
                remote_workspaces.push(sync_data.workspace);
                remote_servers.append(&mut sync_data.servers);
            }
            Err(err) => {
                tracing::warn!("Failed to parse {:?}: {}", path, err);
            }
        }
    }

    (remote_workspaces, remote_servers, pulled_workspace_ids)
}

/// Resolve the OAuth token from either the provided value or the encrypted
/// file on disk.
fn resolve_token(
    provided: Option<String>,
    app: &AppHandle,
    state: &State<'_, AppState>,
) -> Result<String, String> {
    if let Some(t) = provided {
        return Ok(t);
    }
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let token_path = app_dir.join("github_token.enc");
    let encrypted =
        fs::read_to_string(&token_path).map_err(|_| "Sessão não encontrada".to_string())?;
    state
        .crypto
        .decrypt(&encrypted)
        .map_err(|_| "Token inválido ou cofre bloqueado".to_string())
}

// ─── Pull ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn pull_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
    _workspace_id: String,
    provided_token: Option<String>,
) -> Result<(), String> {
    let _lock = state
        .sync_lock
        .try_lock()
        .map_err(|_| "Sincronização já em andamento")?;

    let token = resolve_token(provided_token, &app, &state)?;

    tracing::info!("pull_workspace: starting...");

    let repo_info = repo::ensure_sync_repo_exists(&token).await.map_err(|e| {
        tracing::error!("pull_workspace: failed to ensure sync repo: {}", e);
        e.to_string()
    })?;

    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let sync_service = git_ops::GitSyncService::new(&app_dir);

    let git_repo = sync_service
        .init_repo(&repo_info.clone_url, &token)
        .map_err(|e| {
            tracing::error!("pull_workspace: failed to init/clone repo: {}", e);
            e.to_string()
        })?;

    sync_service.pull(&git_repo, &token).map_err(|e| {
        tracing::error!("pull_workspace: git pull failed: {}", e);
        e.to_string()
    })?;

    // Log vault_sync.json presence
    let vault_sync_path = app_dir.join("sync_repo/vault_sync.json");
    if vault_sync_path.exists() {
        tracing::info!("pull_workspace: synced vault found");
    } else {
        tracing::info!("pull_workspace: no synced vault found");
    }

    // Read remote JSONs
    let workspaces_dir = app_dir.join("sync_repo/workspaces");
    let (remote_workspaces, remote_servers, pulled_workspace_ids) =
        read_remote_jsons(&workspaces_dir);

    tracing::info!(
        "pull_workspace: parsed {} remote workspaces, {} remote servers",
        remote_workspaces.len(),
        remote_servers.len(),
    );

    // Merge into local SQLite (LWW by HLC)
    merge::merge_workspaces(&state, remote_workspaces)
        .await
        .map_err(|e| e.to_string())?;

    merge::merge_servers(&state, remote_servers, &pulled_workspace_ids)
        .await
        .map_err(|e| e.to_string())?;

    tracing::info!("pull_workspace: done");
    Ok(())
}

// ─── Push ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn push_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
    _workspace_id: String,
    provided_token: Option<String>,
) -> Result<(), String> {
    let _lock = state
        .sync_lock
        .try_lock()
        .map_err(|_| "Sincronização já em andamento")?;

    let token = resolve_token(provided_token, &app, &state)?;

    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let sync_service = git_ops::GitSyncService::new(&app_dir);

    let repo_info = repo::ensure_sync_repo_exists(&token)
        .await
        .map_err(|e| e.to_string())?;

    let git_repo = sync_service
        .init_repo(&repo_info.clone_url, &token)
        .map_err(|e| e.to_string())?;

    // ── Step 1: Pull remote HEAD so we can fast-forward ──
    sync_service
        .pull(&git_repo, &token)
        .map_err(|e| e.to_string())?;

    // ── Step 2: Merge remote JSONs into local DB (LWW) ──
    // This is the key difference from the old implementation: we run the full
    // merge *before* serializing so that data from other devices is preserved
    // if it has a newer HLC.
    let workspaces_dir = app_dir.join("sync_repo/workspaces");
    let (remote_workspaces, remote_servers, pulled_workspace_ids) =
        read_remote_jsons(&workspaces_dir);

    tracing::info!(
        "push_workspace: merging {} remote workspaces, {} remote servers before push",
        remote_workspaces.len(),
        remote_servers.len(),
    );

    merge::merge_workspaces(&state, remote_workspaces)
        .await
        .map_err(|e| e.to_string())?;

    merge::merge_servers(&state, remote_servers, &pulled_workspace_ids)
        .await
        .map_err(|e| e.to_string())?;

    // ── Step 3: Serialize the post-merge local DB to JSON files ──
    let resolved_workspaces = merge::get_local_workspaces(&state)
        .await
        .map_err(|e| e.to_string())?;

    let resolved_servers = merge::get_local_servers(&state)
        .await
        .map_err(|e| e.to_string())?;

    if !workspaces_dir.exists() {
        fs::create_dir_all(&workspaces_dir).map_err(|e| e.to_string())?;
    }

    // Cleanup legacy flat files if present
    for legacy in &["sync_repo/workspaces.json", "sync_repo/servers.json"] {
        let p = app_dir.join(legacy);
        if p.exists() {
            let _ = fs::remove_file(&p);
        }
    }

    for workspace in &resolved_workspaces {
        let file_path = workspaces_dir.join(format!("{}.json", workspace.id));

        if !workspace.sync_enabled || workspace.deleted {
            // Remove the JSON file so the remote knows this workspace
            // is no longer synced.
            if file_path.exists() {
                let _ = fs::remove_file(&file_path);
            }
            continue;
        }

        // Collect non-deleted servers for this workspace.
        // Note: `password_enc` is annotated with `#[serde(skip_serializing)]`
        // in CRDTServer, so it will never appear in the JSON output.
        let ws_servers: Vec<merge::CRDTServer> = resolved_servers
            .iter()
            .filter(|s| s.workspace_id == workspace.id && !s.deleted)
            .cloned()
            .collect();

        let sync_data = merge::WorkspaceSyncData {
            workspace: workspace.clone(),
            servers: ws_servers,
        };

        let json_str = serde_json::to_string_pretty(&sync_data).map_err(|e| e.to_string())?;
        fs::write(&file_path, json_str).map_err(|e| e.to_string())?;
    }

    // ── Step 4: Export vault config ──
    match state.crypto.get_vault_payload() {
        Ok(payload) => {
            let vault_sync_path = app_dir.join("sync_repo/vault_sync.json");
            let _ = fs::write(&vault_sync_path, payload);
        }
        Err(e) => {
            tracing::warn!("Vault not configured or export failed: {}", e);
        }
    }

    // ── Step 5: Commit & push ──
    let commit_message = format!(
        "Sync from {} at {}",
        state.node_id,
        chrono::Utc::now().to_rfc3339()
    );
    sync_service
        .push(&git_repo, &token, &commit_message)
        .map_err(|e| format!("Failed to push: {}", e))?;

    tracing::info!("push_workspace: done");
    Ok(())
}
