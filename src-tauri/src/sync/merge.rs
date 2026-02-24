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

pub async fn get_local_workspaces(state: &State<'_, AppState>) -> Result<Vec<CRDTWorkspace>> {
    let local_workspaces = sqlx::query("SELECT * FROM workspaces")
        .fetch_all(&state.db.pool)
        .await?;
        
    let mut results = Vec::new();
    for row in local_workspaces {
        let id: Uuid = row.get("id");
        let id_str = id.to_string();
        let name: String = row.get("name");
        let color: String = row.get("color");
        let sync_enabled: bool = row.get("sync_enabled");
        let hlc: String = row.get("hlc");
        let deleted: bool = row.get("deleted");
        
        results.push(CRDTWorkspace {
            id: id_str, name, color, sync_enabled, hlc, deleted
        });
    }
    Ok(results)
}

pub async fn merge_workspaces(state: &State<'_, AppState>, remote_workspaces: Vec<CRDTWorkspace>) -> Result<Vec<CRDTWorkspace>> {
    let mut resolved_workspaces = Vec::new();
    
    let local_workspaces = get_local_workspaces(state).await?;
        
    let mut local_map = std::collections::HashMap::new();
    for ws in local_workspaces {
        local_map.insert(ws.id.clone(), ws);
    }

    // Unconditionally apply remote state
    for remote in remote_workspaces {
        if let Some(_) = local_map.get(&remote.id) {
            let remote_id = Uuid::parse_str(&remote.id).unwrap_or_default();
            // Remote wins unconditionally on pull
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
    
    // Whatever is left in local_map is from local and doesn't exist in remote.
    // Since this is a manual Pull (overwrite local with remote), we should delete them from the local DB.
    for (id_str, _) in local_map {
        let id_uuid = Uuid::parse_str(&id_str).unwrap_or_default();
        sqlx::query("DELETE FROM workspaces WHERE id = ?").bind(&id_uuid).execute(&state.db.pool).await?;
    }
    
    Ok(resolved_workspaces)
}


pub async fn get_local_servers(state: &State<'_, AppState>) -> Result<Vec<CRDTServer>> {
    let local_servers = sqlx::query("SELECT * FROM servers")
        .fetch_all(&state.db.pool)
        .await?;
        
    let mut results = Vec::new();
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
        
        results.push(CRDTServer {
            id: id_str, workspace_id: workspace_id_str, name, host, port: port as u16, username, tags, password_enc, hlc, deleted
        });
    }
    Ok(results)
}

pub async fn merge_servers(state: &State<'_, AppState>, remote_servers: Vec<CRDTServer>) -> Result<Vec<CRDTServer>> {
    let mut resolved_servers = Vec::new();
    
    let local_servers = get_local_servers(state).await?;
        
    let mut local_map = std::collections::HashMap::new();
    for srv in local_servers {
        local_map.insert(srv.id.clone(), srv);
    }

    for remote in remote_servers {
        if let Some(_) = local_map.get(&remote.id) {
            let remote_id = Uuid::parse_str(&remote.id).unwrap_or_default();
            // Remote wins unconditionally on pull
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
    
    for (id_str, _) in local_map {
        let id_uuid = Uuid::parse_str(&id_str).unwrap_or_default();
        sqlx::query("DELETE FROM servers WHERE id = ?").bind(&id_uuid).execute(&state.db.pool).await?;
    }
    
    Ok(resolved_servers)
}
