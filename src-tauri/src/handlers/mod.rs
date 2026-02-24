pub mod auth;
pub mod server;
pub mod sftp;
pub mod ssh;
pub mod vault;
pub mod workspace;

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}
