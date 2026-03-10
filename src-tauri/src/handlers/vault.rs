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

/// Persist the current UTC timestamp into `vault_meta.json` so the frontend
/// can show "last session" information on the unlock screen.
fn record_last_access(app: &tauri::AppHandle) {
    if let Ok(app_dir) = app.path().app_data_dir() {
        let meta_path = app_dir.join("vault_meta.json");
        let now = chrono::Utc::now().to_rfc3339();
        let payload = serde_json::json!({ "last_unlocked_at": now });
        if let Err(e) = std::fs::write(
            &meta_path,
            serde_json::to_string_pretty(&payload).unwrap_or_default(),
        ) {
            tracing::warn!("Failed to write vault_meta.json: {}", e);
        }
    }
}

#[tauri::command]
#[tracing::instrument(skip(app))]
pub fn get_vault_last_access(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let meta_path = app_dir.join("vault_meta.json");
    if !meta_path.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    Ok(parsed
        .get("last_unlocked_at")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string()))
}

#[tauri::command]
#[tracing::instrument(skip(state, password, app))]
pub fn setup_vault(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    password: String,
) -> Result<(), String> {
    if password.is_empty() {
        return Err("Password cannot be empty".to_string());
    }
    state
        .crypto
        .setup_vault(&password)
        .map_err(|e| e.to_string())?;
    record_last_access(&app);
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip(state, password, app))]
pub fn unlock_vault(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    password: String,
) -> Result<(), String> {
    if password.is_empty() {
        return Err("Password cannot be empty".to_string());
    }
    state.crypto.unlock(&password).map_err(|e| e.to_string())?;
    record_last_access(&app);
    Ok(())
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
        record_last_access(&app);
    }

    import_result
}
