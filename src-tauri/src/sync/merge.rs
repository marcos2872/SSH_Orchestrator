use crate::sync::crdt::HLC;
use crate::AppState;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use sqlx::Row;
use tauri::State;
use uuid::Uuid;

// ─── Sync Data Structures ───────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WorkspaceSyncData {
    pub workspace: CRDTWorkspace,
    pub servers: Vec<CRDTServer>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CRDTWorkspace {
    pub id: String,
    pub name: String,
    pub color: String,
    pub sync_enabled: bool,
    pub hlc: String,
    pub deleted: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CRDTServer {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub tags: String,
    /// Always `None` in sync payloads — passwords are never transmitted between
    /// devices because each vault has a different DEK.  Kept in the struct so
    /// that `get_local_servers` can read the column without a separate type.
    #[serde(skip_serializing)]
    #[serde(default)]
    pub password_enc: Option<String>,
    pub hlc: String,
    pub deleted: bool,
}

// ─── Read helpers ───────────────────────────────────────────────────────────

pub async fn get_local_workspaces(state: &State<'_, AppState>) -> Result<Vec<CRDTWorkspace>> {
    let rows = sqlx::query("SELECT * FROM workspaces")
        .fetch_all(&state.db.pool)
        .await?;

    let mut results = Vec::new();
    for row in rows {
        let id: Uuid = row.get("id");
        results.push(CRDTWorkspace {
            id: id.to_string(),
            name: row.get("name"),
            color: row.get("color"),
            sync_enabled: row.get("sync_enabled"),
            hlc: row.get("hlc"),
            deleted: row.get("deleted"),
        });
    }
    Ok(results)
}

pub async fn get_local_servers(state: &State<'_, AppState>) -> Result<Vec<CRDTServer>> {
    let rows = sqlx::query("SELECT * FROM servers")
        .fetch_all(&state.db.pool)
        .await?;

    let mut results = Vec::new();
    for row in rows {
        let id: Uuid = row.get("id");
        let workspace_id: Uuid = row.get("workspace_id");
        let port: i64 = row.get("port");
        results.push(CRDTServer {
            id: id.to_string(),
            workspace_id: workspace_id.to_string(),
            name: row.get("name"),
            host: row.get("host"),
            port: port as u16,
            username: row.get("username"),
            tags: row.get("tags"),
            password_enc: row.get("password_enc"),
            hlc: row.get("hlc"),
            deleted: row.get("deleted"),
        });
    }
    Ok(results)
}

// ─── Workspace merge ────────────────────────────────────────────────────────

/// Merge remote workspaces into the local SQLite database using Last-Writer-Wins
/// semantics based on HLC comparison.
///
/// Returns the resolved set of workspaces (useful for callers that want to
/// inspect the result, e.g. push-after-merge).
pub async fn merge_workspaces(
    state: &State<'_, AppState>,
    remote_workspaces: Vec<CRDTWorkspace>,
) -> Result<Vec<CRDTWorkspace>> {
    let local_workspaces = get_local_workspaces(state).await?;

    let mut local_map: std::collections::HashMap<String, CRDTWorkspace> = local_workspaces
        .into_iter()
        .map(|ws| (ws.id.clone(), ws))
        .collect();

    let mut resolved: Vec<CRDTWorkspace> = Vec::new();

    for remote in remote_workspaces {
        if let Some(local) = local_map.remove(&remote.id) {
            let local_hlc = HLC::parse(&local.hlc);
            let remote_hlc = HLC::parse(&remote.hlc);

            let winner = if remote_hlc > local_hlc {
                &remote
            } else {
                &local
            };

            let winner_id = Uuid::parse_str(&winner.id).unwrap_or_default();
            sqlx::query(
                "UPDATE workspaces SET name = ?, color = ?, sync_enabled = ?, hlc = ?, deleted = ? WHERE id = ?"
            )
                .bind(&winner.name)
                .bind(&winner.color)
                .bind(winner.sync_enabled)
                .bind(&winner.hlc)
                .bind(winner.deleted)
                .bind(winner_id)
                .execute(&state.db.pool)
                .await?;

            tracing::debug!(
                "merge_workspaces: id={} winner={} (local_hlc={}, remote_hlc={})",
                winner.id,
                if remote_hlc > local_hlc {
                    "remote"
                } else {
                    "local"
                },
                local.hlc,
                remote.hlc,
            );

            resolved.push(winner.clone());
        } else {
            // New workspace from remote — insert it
            let remote_id = Uuid::parse_str(&remote.id).unwrap_or_default();
            sqlx::query(
                "INSERT INTO workspaces (id, name, color, sync_enabled, local_only, updated_at, hlc, deleted) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            )
                .bind(remote_id)
                .bind(&remote.name)
                .bind(&remote.color)
                .bind(remote.sync_enabled)
                .bind(false)
                .bind(chrono::Utc::now())
                .bind(&remote.hlc)
                .bind(remote.deleted)
                .execute(&state.db.pool)
                .await?;

            tracing::info!(
                "merge_workspaces: inserted new remote workspace '{}'",
                remote.name
            );
            resolved.push(remote);
        }
    }

    // Workspaces that exist locally but NOT on remote.
    // These are local-only or have never been pushed yet — leave them untouched.
    // We do NOT disable sync_enabled or delete them; that would destroy data
    // that simply hasn't been pushed yet.
    for (_id, ws) in local_map {
        resolved.push(ws);
    }

    Ok(resolved)
}

// ─── Server merge ───────────────────────────────────────────────────────────

/// Merge remote servers into the local SQLite database using LWW / HLC.
///
/// `pulled_workspace_ids` limits the scope of the merge: only servers that
/// belong to workspaces we actually received from the remote are candidates.
/// This protects servers in non-synced / local-only workspaces from being
/// touched.
pub async fn merge_servers(
    state: &State<'_, AppState>,
    remote_servers: Vec<CRDTServer>,
    pulled_workspace_ids: &std::collections::HashSet<String>,
) -> Result<Vec<CRDTServer>> {
    let local_servers = get_local_servers(state).await?;

    // Build a map of only the local servers that belong to pulled workspaces.
    let mut local_map: std::collections::HashMap<String, CRDTServer> = local_servers
        .into_iter()
        .filter(|s| pulled_workspace_ids.contains(&s.workspace_id))
        .map(|s| (s.id.clone(), s))
        .collect();

    let mut resolved: Vec<CRDTServer> = Vec::new();

    for remote in remote_servers {
        if let Some(local) = local_map.remove(&remote.id) {
            let local_hlc = HLC::parse(&local.hlc);
            let remote_hlc = HLC::parse(&remote.hlc);

            if remote_hlc > local_hlc {
                // Remote wins — update metadata but KEEP the local password_enc
                // because the remote payload never carries passwords.
                let remote_id = Uuid::parse_str(&remote.id).unwrap_or_default();
                sqlx::query(
                    "UPDATE servers SET name = ?, host = ?, port = ?, username = ?, tags = ?, \
                     hlc = ?, deleted = ? WHERE id = ?",
                )
                .bind(&remote.name)
                .bind(&remote.host)
                .bind(remote.port)
                .bind(&remote.username)
                .bind(&remote.tags)
                .bind(&remote.hlc)
                .bind(remote.deleted)
                .bind(remote_id)
                .execute(&state.db.pool)
                .await?;

                tracing::debug!(
                    "merge_servers: id={} remote wins (local={}, remote={})",
                    remote.id,
                    local.hlc,
                    remote.hlc,
                );

                // Return the merged view: remote metadata, local password kept
                let mut merged = remote.clone();
                merged.password_enc = local.password_enc;
                resolved.push(merged);
            } else {
                // Local wins — keep everything as-is
                tracing::debug!(
                    "merge_servers: id={} local wins (local={}, remote={})",
                    local.id,
                    local.hlc,
                    remote.hlc,
                );
                resolved.push(local);
            }
        } else {
            // New server from remote — insert (without password)
            let remote_id = Uuid::parse_str(&remote.id).unwrap_or_default();
            let remote_ws_id = Uuid::parse_str(&remote.workspace_id).unwrap_or_default();
            sqlx::query(
                "INSERT INTO servers (id, workspace_id, name, host, port, username, tags, password_enc, hlc, deleted) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)"
            )
                .bind(remote_id)
                .bind(remote_ws_id)
                .bind(&remote.name)
                .bind(&remote.host)
                .bind(remote.port)
                .bind(&remote.username)
                .bind(&remote.tags)
                .bind(&remote.hlc)
                .bind(remote.deleted)
                .execute(&state.db.pool)
                .await?;

            tracing::info!(
                "merge_servers: inserted new remote server '{}' (host={})",
                remote.name,
                remote.host,
            );
            resolved.push(remote);
        }
    }

    // Servers that exist locally for pulled workspaces but are NOT on the remote.
    // Instead of hard-deleting (which violates the soft-delete convention and
    // destroys data), we soft-delete them — the remote is considered the source
    // of truth for the set of servers within synced workspaces.
    for (id_str, local_srv) in &local_map {
        if !local_srv.deleted {
            let id_uuid = Uuid::parse_str(id_str).unwrap_or_default();
            let hlc = HLC::now(&state.node_id).to_string_repr();
            sqlx::query("UPDATE servers SET deleted = 1, hlc = ? WHERE id = ?")
                .bind(&hlc)
                .bind(id_uuid)
                .execute(&state.db.pool)
                .await?;
            tracing::info!(
                "merge_servers: soft-deleted local server '{}' (not present in remote)",
                local_srv.name,
            );
        }
    }

    // Include the (now soft-deleted) leftovers in the resolved set
    for (_id, srv) in local_map {
        resolved.push(srv);
    }

    Ok(resolved)
}
