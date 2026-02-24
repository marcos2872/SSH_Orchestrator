use crate::services::crypto::CryptoService;
use crate::services::db::DbService;
use crate::services::ssh::SshService;
use tauri::Manager;

pub struct AppState {
    pub db: DbService,
    pub ssh: SshService,
    pub crypto: CryptoService,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing::info!("Starting SSH Config Sync backend...");
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let handle = app.handle();
            tauri::async_runtime::block_on(async move {
                let app_dir = handle
                    .path()
                    .app_data_dir()
                    .expect("failed to get app data dir");
                std::fs::create_dir_all(&app_dir).expect("failed to create app data dir");

                tracing::info!("Initializing database at {:?}", app_dir);
                let db = DbService::new(&handle).await.expect("failed to init db");
                
                tracing::info!("Initializing crypto service (Vault)");
                let crypto = CryptoService::new(&app_dir).expect("failed to init crypto");

                tracing::info!("Services initialized, injecting into Tauri state");
                handle.manage(AppState {
                    db,
                    ssh: SshService::new(),
                    crypto,
                });
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            handlers::greet,
            handlers::workspace::get_workspaces,
            handlers::workspace::create_workspace,
            handlers::workspace::update_workspace,
            handlers::workspace::delete_workspace,
            handlers::server::get_servers,
            handlers::server::create_server,
            handlers::server::update_server,
            handlers::server::delete_server,
            handlers::server::get_server_password,
            handlers::ssh::ssh_connect,
            handlers::ssh::ssh_write,
            handlers::ssh::ssh_disconnect,
            handlers::vault::is_vault_configured,
            handlers::vault::is_vault_locked,
            handlers::vault::unlock_vault,
            handlers::vault::setup_vault,
            handlers::auth::github_login,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub mod handlers;
pub mod models;
pub mod services;
pub mod sync;
pub mod auth;
