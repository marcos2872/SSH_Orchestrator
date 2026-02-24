use sqlx::{sqlite::SqliteConnectOptions, SqlitePool};
use std::fs;
use tauri::{AppHandle, Manager};
use anyhow::Result;

pub struct DbService {
    pub pool: SqlitePool,
}

impl DbService {
    pub async fn new(app_handle: &AppHandle) -> Result<Self> {
        let app_dir = app_handle.path().app_data_dir().expect("failed to get app data dir");
        fs::create_dir_all(&app_dir)?;
        
        let db_path = app_dir.join("ssh_config.db");
        let options = SqliteConnectOptions::new()
            .filename(db_path)
            .create_if_missing(true);
            
        let pool = SqlitePool::connect_with(options).await?;
        
        // workspaces table
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS workspaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                sync_enabled BOOLEAN NOT NULL DEFAULT 0,
                local_only BOOLEAN NOT NULL DEFAULT 0,
                color TEXT NOT NULL,
                updated_at DATETIME NOT NULL
            )"
        ).execute(&pool).await?;

        // servers table
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS servers (
                id TEXT PRIMARY KEY,
                workspace_id TEXT NOT NULL,
                name TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                username TEXT NOT NULL,
                tags TEXT NOT NULL,
                folder_color TEXT,
                password_enc TEXT,
                FOREIGN KEY(workspace_id) REFERENCES workspaces(id)
            )"
        ).execute(&pool).await?;

        // Migration: add password_enc to existing DBs that don't have it yet
        sqlx::query(
            "ALTER TABLE servers ADD COLUMN password_enc TEXT"
        )
        .execute(&pool)
        .await
        .ok(); // ignore error — column already exists

        Ok(Self { pool })
    }
}
