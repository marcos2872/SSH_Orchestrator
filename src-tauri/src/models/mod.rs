use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub mod vault;

#[derive(Debug, Serialize, Deserialize, Clone, sqlx::FromRow)]
pub struct Workspace {
    pub id: Uuid,
    pub name: String,
    pub sync_enabled: bool,
    pub local_only: bool,
    pub color: String,
    pub updated_at: DateTime<Utc>,
    pub hlc: String,
    pub deleted: bool,
}

// Intermediate struct used for DB mapping (tags stored as JSON string in SQLite)
#[derive(Debug, sqlx::FromRow)]
pub struct ServerRow {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub name: String,
    pub host: String,
    pub port: i64,
    pub username: String,
    pub tags: String,
    pub folder_color: Option<String>,
    pub password_enc: Option<String>,
    pub hlc: String,
    pub deleted: bool,
}

impl ServerRow {
    pub fn into_server(self) -> Server {
        Server {
            id: self.id,
            workspace_id: self.workspace_id,
            name: self.name,
            host: self.host,
            port: self.port as u16,
            username: self.username,
            tags: serde_json::from_str(&self.tags).unwrap_or_default(),
            folder_color: self.folder_color,
            has_saved_password: self.password_enc.is_some(),
            hlc: self.hlc,
            deleted: self.deleted,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Server {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub tags: Vec<String>,
    pub folder_color: Option<String>,
    /// True if an encrypted password is stored — never expose the actual password to the frontend
    pub has_saved_password: bool,
    pub hlc: String,
    pub deleted: bool,
}
