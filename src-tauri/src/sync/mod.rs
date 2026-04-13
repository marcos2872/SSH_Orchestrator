pub mod crdt;
pub mod git_ops;
pub mod merge;
pub mod repo;

use crate::AppState;
use std::fs;
use tauri::{AppHandle, Emitter, Manager, State};

// ─── Progress Events ────────────────────────────────────────────────────────

/// Payload emitted to the frontend via `sync://progress` events so the UI can
/// show step-by-step feedback during pull / push operations.
#[derive(Clone, serde::Serialize)]
pub struct SyncProgressEvent {
    pub step: String,
    pub detail: String,
}

/// Helper to emit a progress event.  Failures are silently ignored — progress
/// reporting is best-effort.
fn emit_progress(app: &AppHandle, step: &str, detail: &str) {
    let _ = app.emit(
        "sync://progress",
        SyncProgressEvent {
            step: step.to_string(),
            detail: detail.to_string(),
        },
    );
}

// ─── Shared Helpers ─────────────────────────────────────────────────────────

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
        tracing::debug!("read_remote_jsons: workspaces dir does not exist yet");
        return (remote_workspaces, remote_servers, pulled_workspace_ids);
    }

    let entries = match fs::read_dir(workspaces_dir) {
        Ok(e) => e,
        Err(err) => {
            tracing::warn!("Failed to read workspaces dir: {}", err);
            return (remote_workspaces, remote_servers, pulled_workspace_ids);
        }
    };

    let mut json_files_found: u32 = 0;
    let mut parse_ok: u32 = 0;
    let mut parse_failed: u32 = 0;
    let mut read_failed: u32 = 0;
    let mut failed_files: Vec<String> = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        json_files_found += 1;
        let filename = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();

        let json_str = match fs::read_to_string(&path) {
            Ok(s) => s,
            Err(err) => {
                read_failed += 1;
                failed_files.push(filename.clone());
                tracing::warn!(
                    "Failed to read {:?}: {} (file may be locked or inaccessible)",
                    path,
                    err,
                );
                continue;
            }
        };

        // Basic sanity check before attempting deserialization
        let trimmed = json_str.trim();
        if trimmed.is_empty() {
            parse_failed += 1;
            failed_files.push(filename.clone());
            tracing::warn!(
                "Skipping {:?}: file is empty (possible partial write / corruption)",
                path,
            );
            continue;
        }

        match serde_json::from_str::<merge::WorkspaceSyncData>(&json_str) {
            Ok(mut sync_data) => {
                parse_ok += 1;
                let server_count = sync_data.servers.len();
                tracing::debug!(
                    "Parsed {:?}: workspace='{}', {} server(s)",
                    filename,
                    sync_data.workspace.name,
                    server_count,
                );
                pulled_workspace_ids.insert(sync_data.workspace.id.clone());
                remote_workspaces.push(sync_data.workspace);
                remote_servers.append(&mut sync_data.servers);
            }
            Err(err) => {
                parse_failed += 1;
                failed_files.push(filename.clone());
                tracing::warn!(
                    "Failed to parse {:?}: {} (file may be corrupted or in an old format)",
                    path,
                    err,
                );
            }
        }
    }

    // Summary log so operators can quickly spot data-integrity issues
    if json_files_found == 0 {
        tracing::info!("read_remote_jsons: no JSON files found in workspaces dir");
    } else {
        let failures = read_failed + parse_failed;
        if failures > 0 {
            tracing::warn!(
                "read_remote_jsons summary: {}/{} JSON files parsed successfully, {} failed [{}]",
                parse_ok,
                json_files_found,
                failures,
                failed_files.join(", "),
            );
        } else {
            tracing::info!(
                "read_remote_jsons summary: all {}/{} JSON files parsed successfully ({} workspace(s), {} server(s))",
                parse_ok,
                json_files_found,
                remote_workspaces.len(),
                remote_servers.len(),
            );
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
    provided_token: Option<String>,
) -> Result<(), String> {
    let _lock = state.sync_lock.try_lock().map_err(|_| {
        tracing::warn!("pull_workspace: sync lock already held");
        "Sincronização já em andamento".to_string()
    })?;

    let token = resolve_token(provided_token, &app, &state)?;

    tracing::info!("pull_workspace: starting…");
    emit_progress(&app, "connect", "Conectando ao GitHub…");

    let repo_info = repo::ensure_sync_repo_exists(&token).await.map_err(|e| {
        tracing::error!("pull_workspace: failed to ensure sync repo: {}", e);
        e.to_string()
    })?;

    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    // ── Git operations run on a blocking thread ─────────────────────────
    let clone_url = repo_info.clone_url.clone();
    let tok = token.clone();
    let ad = app_dir.clone();
    let app_clone = app.clone();

    tokio::task::spawn_blocking(move || {
        emit_progress(&app_clone, "fetch", "Baixando dados do repositório…");
        let sync_service = git_ops::GitSyncService::new(&ad);
        let git_repo = sync_service
            .init_repo(&clone_url, &tok)
            .map_err(|e| e.to_string())?;
        sync_service
            .pull(&git_repo, &tok)
            .map_err(|e| e.to_string())?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Blocking task panicked: {}", e))?
    .map_err(|e: String| e)?;

    emit_progress(&app, "merge", "Mesclando dados…");

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

    emit_progress(&app, "done", "Sincronização concluída!");
    tracing::info!("pull_workspace: done");
    Ok(())
}

// ─── Push ───────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn push_workspace(
    app: AppHandle,
    state: State<'_, AppState>,
    provided_token: Option<String>,
) -> Result<(), String> {
    let _lock = state.sync_lock.try_lock().map_err(|_| {
        tracing::warn!("push_workspace: sync lock already held");
        "Sincronização já em andamento".to_string()
    })?;

    let token = resolve_token(provided_token, &app, &state)?;
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    tracing::info!("push_workspace: starting…");
    emit_progress(&app, "connect", "Conectando ao GitHub…");

    let repo_info = repo::ensure_sync_repo_exists(&token)
        .await
        .map_err(|e| e.to_string())?;

    // ── Step 1: Pull remote HEAD (blocking) ─────────────────────────────
    let clone_url = repo_info.clone_url.clone();
    let tok = token.clone();
    let ad = app_dir.clone();
    let app_clone = app.clone();

    tokio::task::spawn_blocking(move || {
        emit_progress(&app_clone, "fetch", "Baixando dados do repositório…");
        let sync_service = git_ops::GitSyncService::new(&ad);
        let git_repo = sync_service
            .init_repo(&clone_url, &tok)
            .map_err(|e| e.to_string())?;
        sync_service
            .pull(&git_repo, &tok)
            .map_err(|e| e.to_string())?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Blocking task panicked: {}", e))?
    .map_err(|e: String| e)?;

    // ── Step 2: Merge remote JSONs into local DB (LWW) ──────────────────
    emit_progress(&app, "merge", "Mesclando dados…");

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

    // ── Step 3: Serialize post-merge local DB to JSON files ─────────────
    emit_progress(&app, "serialize", "Preparando dados para envio…");

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
            if file_path.exists() {
                let _ = fs::remove_file(&file_path);
            }
            continue;
        }

        // `password_enc` is annotated with `#[serde(skip_serializing)]` in
        // CRDTServer so it will never appear in the JSON output.
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

    // ── Step 4: Export vault config ─────────────────────────────────────
    match state.crypto.get_vault_payload() {
        Ok(payload) => {
            let vault_sync_path = app_dir.join("sync_repo/vault_sync.json");
            let _ = fs::write(&vault_sync_path, payload);
        }
        Err(e) => {
            tracing::warn!("Vault not configured or export failed: {}", e);
        }
    }

    // ── Step 5: Commit & push (blocking) ────────────────────────────────
    let tok = token.clone();
    let ad = app_dir.clone();
    let node_id = state.node_id.clone();
    let app_clone = app.clone();

    // Build a descriptive commit message including synced workspace names and
    // server counts so the git history is human-readable.
    let synced_ws: Vec<&str> = resolved_workspaces
        .iter()
        .filter(|ws| ws.sync_enabled && !ws.deleted)
        .map(|ws| ws.name.as_str())
        .collect();
    let total_servers: usize = resolved_servers.iter().filter(|s| !s.deleted).count();

    let ws_summary = if synced_ws.is_empty() {
        "(no synced workspaces)".to_string()
    } else {
        synced_ws.join(", ")
    };

    let commit_message = format!(
        "Sync from {} at {}\n\nWorkspaces: {}\nServers: {}",
        node_id,
        chrono::Utc::now().to_rfc3339(),
        ws_summary,
        total_servers,
    );

    tokio::task::spawn_blocking(move || {
        emit_progress(&app_clone, "push", "Enviando dados para o GitHub…");
        let sync_service = git_ops::GitSyncService::new(&ad);
        let git_repo = sync_service
            .init_repo(
                // We already cloned/opened previously so this is just an open.
                "https://dummy.invalid",
                &tok,
            )
            .map_err(|e| e.to_string())?;
        sync_service
            .push(&git_repo, &tok, &commit_message)
            .map_err(|e| e.to_string())?;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Blocking task panicked: {}", e))?
    .map_err(|e: String| e)?;

    emit_progress(&app, "done", "Sincronização concluída!");
    tracing::info!("push_workspace: done");
    Ok(())
}
