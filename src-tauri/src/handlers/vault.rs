use crate::AppState;
use tauri::{Manager, State};

#[tauri::command]
#[tracing::instrument(skip(state))]
pub fn is_vault_configured(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.crypto.is_configured())
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub fn is_vault_locked(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.crypto.is_locked())
}

#[tauri::command]
#[tracing::instrument(skip(state, password))]
pub fn setup_vault(state: State<'_, AppState>, password: String) -> Result<(), String> {
    if password.is_empty() {
        return Err("Password cannot be empty".to_string());
    }
    state
        .crypto
        .setup_vault(&password)
        .map_err(|e| e.to_string())
}

#[tauri::command]
#[tracing::instrument(skip(state, password))]
pub fn unlock_vault(state: State<'_, AppState>, password: String) -> Result<(), String> {
    if password.is_empty() {
        return Err("Password cannot be empty".to_string());
    }
    state.crypto.unlock(&password).map_err(|e| e.to_string())
}

#[tauri::command]
#[tracing::instrument(skip(app))]
pub fn check_synced_vault(app: tauri::AppHandle) -> Result<bool, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let vault_sync_path = app_dir.join("sync_repo/vault_sync.json");
    let exists = vault_sync_path.exists();
    tracing::info!(
        "Checking for synced vault at {:?}. Exists: {}",
        vault_sync_path,
        exists
    );
    Ok(exists)
}

#[tauri::command]
#[tracing::instrument(skip(app, state, password))]
pub fn import_synced_vault(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    password: String,
) -> Result<(), String> {
    if password.is_empty() {
        return Err("Password cannot be empty".to_string());
    }

    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let vault_sync_path = app_dir.join("sync_repo/vault_sync.json");

    let payload = std::fs::read_to_string(&vault_sync_path)
        .map_err(|_| "O cofre sincronizado não foi encontrado no dispositivo".to_string())?;

    let import_result = state
        .crypto
        .import_vault(&payload, &password)
        .map_err(|e| e.to_string());

    if import_result.is_ok() {
        crate::handlers::auth::reencrypt_token(&app, &state);
    }

    import_result
}
