use crate::AppState;
use crate::services::sftp::{LocalEntry, SftpEntry};
use tauri::State;

#[tauri::command]
pub async fn sftp_open_session(
    state: State<'_, AppState>,
    server_id: String,
) -> Result<String, String> {
    let handle = state
        .ssh
        .get_handle(&server_id)
        .await
        .ok_or_else(|| format!("Sessão SSH ativa não encontrada para servidor: {}", server_id))?;

    state
        .sftp
        .open_session(handle)
        .await
        .map_err(|e| e.to_string())
}

/// Connect directly via SSH+SFTP without spawning a shell (dual-pane file manager).
#[tauri::command]
pub async fn sftp_direct_connect(
    state: State<'_, AppState>,
    host: String,
    port: u16,
    username: String,
    password: String,
) -> Result<String, String> {
    state
        .sftp
        .open_direct(&host, port, &username, &password)
        .await
        .map_err(|e| e.to_string())
}

/// List local filesystem entries (dual-pane file manager).
#[tauri::command]
pub fn sftp_list_local(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<LocalEntry>, String> {
    state
        .sftp
        .list_local(&path)
        .map_err(|e| e.to_string())
}

/// Get the remote home directory for a given SFTP session (realpath(".")).
#[tauri::command]
pub async fn sftp_workdir(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<String, String> {
    state
        .sftp
        .workdir(&session_id)
        .await
        .map_err(|e| e.to_string())
}

/// Get the local home directory ($HOME).
#[tauri::command]
pub fn sftp_home_dir(
    state: State<'_, AppState>,
) -> String {
    state.sftp.home_dir()
}

#[tauri::command]
pub async fn sftp_list_dir(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<Vec<SftpEntry>, String> {
    state
        .sftp
        .list_dir(&session_id, &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_upload(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    session_id: String,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
    state
        .sftp
        .upload(&session_id, &local_path, &remote_path, &app)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_download(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    session_id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    state
        .sftp
        .download(&session_id, &remote_path, &local_path, &app)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_delete(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    state
        .sftp
        .delete(&session_id, &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_rename(
    state: State<'_, AppState>,
    session_id: String,
    from: String,
    to: String,
) -> Result<(), String> {
    state
        .sftp
        .rename(&session_id, &from, &to)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_mkdir(
    state: State<'_, AppState>,
    session_id: String,
    path: String,
) -> Result<(), String> {
    state
        .sftp
        .mkdir(&session_id, &path)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sftp_close_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    state
        .sftp
        .close_session(&session_id)
        .await
        .map_err(|e| e.to_string())
}
