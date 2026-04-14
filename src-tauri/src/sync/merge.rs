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
    /// AES-256-GCM encrypted password (using the shared vault DEK).
    /// The vault DEK is synced across devices via `vault_sync.json`, so the
    /// ciphertext is decryptable on any device that has the same master password.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password_enc: Option<String>,
    /// AES-256-GCM encrypted SSH private key (PEM), using the shared vault DEK.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_key_enc: Option<String>,
    /// AES-256-GCM encrypted passphrase for the SSH private key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ssh_key_passphrase_enc: Option<String>,
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
            ssh_key_enc: row.get("ssh_key_enc"),
            ssh_key_passphrase_enc: row.get("ssh_key_passphrase_enc"),
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

            let winner_id = Uuid::parse_str(&winner.id)
                .map_err(|e| anyhow::anyhow!("UUID inválido no merge de workspaces: {e}"))?;
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
            let remote_id = Uuid::parse_str(&remote.id)
                .map_err(|e| anyhow::anyhow!("UUID inválido no merge de workspaces: {e}"))?;
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
///
/// Credentials (`password_enc`, `ssh_key_enc`, `ssh_key_passphrase_enc`) are
/// included in the sync payload because the vault DEK is shared across devices
/// via `vault_sync.json`. LWW applies to all fields including credentials.
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
                // Remote wins — update all fields including credentials
                let remote_id = Uuid::parse_str(&remote.id)
                    .map_err(|e| anyhow::anyhow!("UUID inválido no merge de servidores: {e}"))?;
                sqlx::query(
                    "UPDATE servers \
                     SET name = ?, host = ?, port = ?, username = ?, tags = ?, \
                         password_enc = ?, ssh_key_enc = ?, ssh_key_passphrase_enc = ?, \
                         hlc = ?, deleted = ? \
                     WHERE id = ?",
                )
                .bind(&remote.name)
                .bind(&remote.host)
                .bind(remote.port)
                .bind(&remote.username)
                .bind(&remote.tags)
                .bind(&remote.password_enc)
                .bind(&remote.ssh_key_enc)
                .bind(&remote.ssh_key_passphrase_enc)
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

                resolved.push(remote);
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
            // New server from remote — verify workspace exists before inserting
            let remote_id = Uuid::parse_str(&remote.id)
                .map_err(|e| anyhow::anyhow!("UUID inválido no merge de servidores: {e}"))?;
            let remote_ws_id = Uuid::parse_str(&remote.workspace_id).map_err(|e| {
                anyhow::anyhow!("workspace_id UUID inválido no merge de servidores: {e}")
            })?;

            // Garantir que o workspace de destino existe localmente (evitar FK dangling)
            let ws_exists: bool = sqlx::query_scalar(
                "SELECT EXISTS(SELECT 1 FROM workspaces WHERE id = ?)",
            )
            .bind(remote_ws_id)
            .fetch_one(&state.db.pool)
            .await?;

            if !ws_exists {
                tracing::warn!(
                    "merge_servers: ignorando servidor '{}' — workspace {} não existe localmente",
                    remote.name,
                    remote.workspace_id,
                );
                continue;
            }
            sqlx::query(
                "INSERT INTO servers \
                 (id, workspace_id, name, host, port, username, tags, \
                  password_enc, ssh_key_enc, ssh_key_passphrase_enc, hlc, deleted) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(remote_id)
            .bind(remote_ws_id)
            .bind(&remote.name)
            .bind(&remote.host)
            .bind(remote.port)
            .bind(&remote.username)
            .bind(&remote.tags)
            .bind(&remote.password_enc)
            .bind(&remote.ssh_key_enc)
            .bind(&remote.ssh_key_passphrase_enc)
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

    // Servers that exist locally but are NOT in the remote payload.
    // Ausência no remoto significa "o remoto ainda não viu esse servidor" — não
    // que foi deletado. Deleção é um evento explícito (deleted=1 com HLC).
    // Deixamos intactos para serem incluídos no próximo push, igual ao
    // comportamento de merge_workspaces.
    for (_id, srv) in local_map {
        resolved.push(srv);
    }

    Ok(resolved)
}
