use anyhow::Result;
use serde::{Deserialize, Serialize};
use crate::AppState;
use tauri::State;
use sqlx::Row;
use uuid::Uuid;

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
    pub password_enc: Option<String>,
    pub hlc: String,
    pub deleted: bool,
}

pub async fn merge_workspaces(state: &State<'_, AppState>, remote_workspaces: Vec<CRDTWorkspace>) -> Result<Vec<CRDTWorkspace>> {
    let mut resolved_workspaces = Vec::new();
    
    // Fetch local workspaces (including deleted ones)
    let local_workspaces = sqlx::query("SELECT * FROM workspaces")
        .fetch_all(&state.db.pool)
        .await?;
        
    let mut local_map = std::collections::HashMap::new();
    for row in local_workspaces {
        let id: Uuid = row.get("id");
        let id_str = id.to_string();
        let name: String = row.get("name");
        let color: String = row.get("color");
        let sync_enabled: bool = row.get("sync_enabled");
        let hlc: String = row.get("hlc");
        let deleted: bool = row.get("deleted");
        
        local_map.insert(id_str.clone(), CRDTWorkspace {
            id: id_str, name, color, sync_enabled, hlc, deleted
        });
    }

    // Compare with remote and store the winner
    for remote in remote_workspaces {
        if let Some(local) = local_map.get(&remote.id) {
            // Compare HLC directly as string (lexicographically matches timestamp)
            if remote.hlc > local.hlc {
                let remote_id = Uuid::parse_str(&remote.id).unwrap_or_default();
                // Remote wins, update local DB
                sqlx::query("UPDATE workspaces SET name = ?, color = ?, sync_enabled = ?, hlc = ?, deleted = ? WHERE id = ?")
                    .bind(&remote.name)
                    .bind(&remote.color)
                    .bind(remote.sync_enabled)
                    .bind(&remote.hlc)
                    .bind(remote.deleted)
                    .bind(&remote_id)
                    .execute(&state.db.pool)
                    .await?;
                
                resolved_workspaces.push(remote.clone());
            } else {
                // Local wins or equal, keep local
                resolved_workspaces.push(local.clone());
            }
            local_map.remove(&remote.id);
        } else {
            let remote_id = Uuid::parse_str(&remote.id).unwrap_or_default();
            // Remote exists but local doesn't (new workspace from another device)
            sqlx::query("INSERT INTO workspaces (id, name, color, sync_enabled, local_only, updated_at, hlc, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(&remote_id)
                .bind(&remote.name)
                .bind(&remote.color)
                .bind(remote.sync_enabled)
                .bind(false)
                .bind(chrono::Utc::now())
                .bind(&remote.hlc)
                .bind(remote.deleted)
                .execute(&state.db.pool)
                .await?;
                
            resolved_workspaces.push(remote);
        }
    }
    
    // Whatever is left in local_map is from local and doesn't exist in remote yet
    for (_, local) in local_map {
        resolved_workspaces.push(local);
    }
    
    Ok(resolved_workspaces)
}


pub async fn merge_servers(state: &State<'_, AppState>, remote_servers: Vec<CRDTServer>) -> Result<Vec<CRDTServer>> {
    let mut resolved_servers = Vec::new();
    
    // Fetch local servers (including deleted ones)
    let local_servers = sqlx::query("SELECT * FROM servers")
        .fetch_all(&state.db.pool)
        .await?;
        
    let mut local_map = std::collections::HashMap::new();
    for row in local_servers {
        let id: Uuid = row.get("id");
        let id_str = id.to_string();
        let workspace_id: Uuid = row.get("workspace_id");
        let workspace_id_str = workspace_id.to_string();
        let name: String = row.get("name");
        let host: String = row.get("host");
        let port: i64 = row.get("port");
        let username: String = row.get("username");
        let tags: String = row.get("tags");
        let password_enc: Option<String> = row.get("password_enc");
        let hlc: String = row.get("hlc");
        let deleted: bool = row.get("deleted");
        
        local_map.insert(id_str.clone(), CRDTServer {
            id: id_str, workspace_id: workspace_id_str, name, host, port: port as u16, username, tags, password_enc, hlc, deleted
        });
    }

    for remote in remote_servers {
        if let Some(local) = local_map.get(&remote.id) {
            if remote.hlc > local.hlc {
                let remote_id = Uuid::parse_str(&remote.id).unwrap_or_default();
                // Remote wins
                sqlx::query("UPDATE servers SET name = ?, host = ?, port = ?, username = ?, tags = ?, password_enc = ?, hlc = ?, deleted = ? WHERE id = ?")
                    .bind(&remote.name)
                    .bind(&remote.host)
                    .bind(remote.port)
                    .bind(&remote.username)
                    .bind(&remote.tags)
                    .bind(&remote.password_enc)
                    .bind(&remote.hlc)
                    .bind(remote.deleted)
                    .bind(&remote_id)
                    .execute(&state.db.pool)
                    .await?;
                resolved_servers.push(remote.clone());
            } else {
                resolved_servers.push(local.clone());
            }
            local_map.remove(&remote.id);
        } else {
            let remote_id = Uuid::parse_str(&remote.id).unwrap_or_default();
            let remote_ws_id = Uuid::parse_str(&remote.workspace_id).unwrap_or_default();
            // New remote server
            sqlx::query("INSERT INTO servers (id, workspace_id, name, host, port, username, tags, password_enc, hlc, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(&remote_id)
                .bind(&remote_ws_id)
                .bind(&remote.name)
                .bind(&remote.host)
                .bind(remote.port)
                .bind(&remote.username)
                .bind(&remote.tags)
                .bind(&remote.password_enc)
                .bind(&remote.hlc)
                .bind(remote.deleted)
                .execute(&state.db.pool)
                .await?;
            resolved_servers.push(remote);
        }
    }
    
    for (_, local) in local_map {
        resolved_servers.push(local);
    }
    
    Ok(resolved_servers)
}
