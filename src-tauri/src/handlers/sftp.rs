use crate::services::sftp::{LocalEntry, SftpEntry};
use crate::AppState;
use tauri::State;

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn sftp_open_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<String, String> {
    let handle = state
        .ssh
        .get_handle(&session_id)
        .await
        .ok_or_else(|| format!("Sessão SSH ativa não encontrada: {}", session_id))?;

    state
        .sftp
        .open_session(handle)
        .await
        .map_err(|e| e.to_string())
}

/// Connect directly via SSH+SFTP without spawning a shell (dual-pane file manager).
///
/// Looks up the server by `server_id`, then resolves credentials in the same
/// priority order as `ssh_connect`:
///   1. Saved encrypted SSH key from DB (decrypted via vault)
///   2. Caller-supplied `password` (typed by the user at the prompt)
///   3. Saved encrypted password from DB (decrypted via vault)
#[tauri::command]
#[tracing::instrument(skip(state, password))]
pub async fn sftp_direct_connect(
    state: State<'_, AppState>,
    server_id: String,
    password: Option<String>,
) -> Result<String, String> {
    use uuid::Uuid;

    let srv_uuid = Uuid::parse_str(&server_id).map_err(|e| e.to_string())?;

    let row = sqlx::query_as::<_, crate::models::ServerRow>("SELECT * FROM servers WHERE id = ?")
        .bind(srv_uuid)
        .fetch_one(&state.db.pool)
        .await
        .map_err(|e| e.to_string())?;

    // ── Resolve SSH key ───────────────────────────────────────────────────────
    let resolved_key: Option<String> = match row.ssh_key_enc.as_deref() {
        Some(enc) => {
            let plain = state.crypto.decrypt(enc).map_err(|e| e.to_string())?;
            Some(plain)
        }
        None => None,
    };

    let resolved_passphrase: Option<String> = if resolved_key.is_some() {
        match row.ssh_key_passphrase_enc.as_deref() {
            Some(enc) => {
                let plain = state.crypto.decrypt(enc).map_err(|e| e.to_string())?;
                Some(plain)
            }
            None => None,
        }
    } else {
        None
    };

    // ── Resolve password (fallback when no key) ───────────────────────────────
    let resolved_password: Option<String> = if resolved_key.is_none() {
        match password.as_deref() {
            Some(pw) if !pw.is_empty() => Some(pw.to_string()),
            _ => match row.password_enc.as_deref() {
                Some(enc) => {
                    let plain = state.crypto.decrypt(enc).map_err(|e| e.to_string())?;
                    Some(plain)
                }
                None => None,
            },
        }
    } else {
        None
    };

    if resolved_key.is_none() && resolved_password.is_none() {
        return Err("Nenhuma credencial disponível. Forneça uma senha ou chave SSH.".to_string());
    }

    state
        .sftp
        .open_direct(
            &row.host,
            row.port as u16,
            &row.username,
            resolved_password.as_deref(),
            resolved_key.as_deref(),
            resolved_passphrase.as_deref(),
        )
        .await
        .map_err(|e| e.to_string())
}

/// List local filesystem entries (dual-pane file manager).
#[tauri::command]
#[tracing::instrument(skip(state))]
pub fn sftp_list_local(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<LocalEntry>, String> {
    state.sftp.list_local(&path).map_err(|e| e.to_string())
}

/// Get the remote home directory for a given SFTP session (realpath(".")).
#[tauri::command]
#[tracing::instrument(skip(state))]
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
#[tracing::instrument(skip(state))]
pub fn sftp_home_dir(state: State<'_, AppState>) -> String {
    state.sftp.home_dir()
}

#[tauri::command]
#[tracing::instrument(skip(state))]
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
#[tracing::instrument(skip(state, app))]
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
#[tracing::instrument(skip(state, app))]
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
#[tracing::instrument(skip(state))]
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
#[tracing::instrument(skip(state))]
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
#[tracing::instrument(skip(state))]
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
#[tracing::instrument(skip(state))]
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

#[tauri::command]
#[tracing::instrument(skip(state))]
pub fn sftp_delete_local(state: State<'_, AppState>, path: String) -> Result<(), String> {
    state.sftp.delete_local(&path).map_err(|e| e.to_string())
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub fn sftp_rename_local(
    state: State<'_, AppState>,
    from: String,
    to: String,
) -> Result<(), String> {
    state
        .sftp
        .rename_local(&from, &to)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub fn sftp_mkdir_local(state: State<'_, AppState>, path: String) -> Result<(), String> {
    state.sftp.mkdir_local(&path).map_err(|e| e.to_string())
}
