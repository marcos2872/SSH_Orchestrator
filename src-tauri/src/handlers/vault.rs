use crate::AppState;
use tauri::State;

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
