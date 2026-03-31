use crate::services::crypto::CryptoService;
use crate::services::db::DbService;
use crate::services::pty::PtyService;
use crate::services::sftp::SftpService;
use crate::services::ssh::SshService;
use tauri::Manager;

pub struct AppState {
    pub db: DbService,
    pub ssh: SshService,
    pub sftp: SftpService,
    pub pty: PtyService,
    pub crypto: CryptoService,
    pub sync_lock: tokio::sync::Mutex<()>,
    /// Stable device identifier used as the node_id component of HLC timestamps.
    pub node_id: String,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    match dotenvy::dotenv() {
        Ok(path) => tracing::info!(".env file loaded from: {:?}", path),
        Err(e) => tracing::warn!("Could not load .env file: {}", e),
    }
    tracing::info!("Starting SSH Config Sync backend...");
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Set window icon explicitly (required on Linux for runtime icon in taskbar/titlebar)
            if let Some(window) = app.get_webview_window("main") {
                window.set_icon(tauri::include_image!("icons/icon.png")).ok();
            }

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

                let node_id = sync::crdt::get_or_create_node_id(&app_dir);
                tracing::info!("Node ID for this device: {}", node_id);

                tracing::info!("Services initialized, injecting into Tauri state");
                handle.manage(AppState {
                    db,
                    ssh: SshService::new(),
                    sftp: SftpService::new(),
                    pty: PtyService::new(),
                    crypto,
                    sync_lock: tokio::sync::Mutex::new(()),
                    node_id,
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
            handlers::ssh::ssh_connect,
            handlers::ssh::ssh_write,
            handlers::ssh::ssh_resize,
            handlers::ssh::ssh_disconnect,
            handlers::sftp::sftp_open_session,
            handlers::sftp::sftp_list_dir,
            handlers::sftp::sftp_upload,
            handlers::sftp::sftp_download,
            handlers::sftp::sftp_delete,
            handlers::sftp::sftp_rename,
            handlers::sftp::sftp_mkdir,
            handlers::sftp::sftp_close_session,
            handlers::sftp::sftp_direct_connect,
            handlers::sftp::sftp_list_local,
            handlers::sftp::sftp_workdir,
            handlers::sftp::sftp_home_dir,
            handlers::sftp::sftp_delete_local,
            handlers::sftp::sftp_rename_local,
            handlers::sftp::sftp_mkdir_local,
            handlers::vault::is_vault_configured,
            handlers::vault::is_vault_locked,
            handlers::vault::unlock_vault,
            handlers::vault::setup_vault,
            handlers::vault::check_synced_vault,
            handlers::vault::import_synced_vault,
            handlers::vault::get_vault_last_access,
            handlers::auth::github_login,
            handlers::auth::get_current_user,
            handlers::auth::github_logout,
            handlers::pty::pty_spawn,
            handlers::pty::pty_write,
            handlers::pty::pty_resize,
            handlers::pty::pty_kill,
            sync::pull_workspace,
            sync::push_workspace,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

pub mod auth;
pub mod handlers;
pub mod models;
pub mod services;
pub mod sync;
