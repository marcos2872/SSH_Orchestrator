use crate::services::crypto::CryptoService;
use crate::AppState;
use tauri::{Manager, State};

/// Frequência do desbloqueio automático (chave em `settings`).
/// `always` = pede a senha toda vez que o app abre (padrão).
pub const UNLOCK_FREQUENCY_KEY: &str = "vault_unlock_frequency";
const WEEK_SECS: i64 = 7 * 24 * 3600;
const MONTH_SECS: i64 = 30 * 24 * 3600;

fn period_secs(frequency: &str) -> Option<i64> {
    match frequency {
        "week" => Some(WEEK_SECS),
        "month" => Some(MONTH_SECS),
        _ => None,
    }
}

async fn read_frequency(pool: &sqlx::SqlitePool) -> String {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?")
        .bind(UNLOCK_FREQUENCY_KEY)
        .fetch_optional(pool)
        .await
        .unwrap_or(None);
    row.map(|(v,)| v).unwrap_or_else(|| "always".to_string())
}

fn read_last_unlocked_at(app: &tauri::AppHandle) -> Option<chrono::DateTime<chrono::Utc>> {
    let app_dir = app.path().app_data_dir().ok()?;
    let raw = std::fs::read_to_string(app_dir.join("vault_meta.json")).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let ts = parsed.get("last_unlocked_at")?.as_str()?;
    chrono::DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|dt| dt.with_timezone(&chrono::Utc))
}

/// Salva a DEK no keychain quando o desbloqueio automático está ativo.
/// Best-effort: falha silenciosa (log) nunca quebra o unlock manual.
async fn store_keychain_if_enabled(state: &State<'_, AppState>) {
    if read_frequency(&state.db.pool).await != "always" {
        if let Err(e) = state.crypto.store_dek_in_keychain() {
            tracing::warn!("Falha ao salvar DEK no keychain: {}", e);
        }
    }
}

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
pub async fn setup_vault(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    password: String,
) -> Result<(), String> {
    if password.len() < 8 {
        return Err("A senha deve ter pelo menos 8 caracteres.".to_string());
    }
    state
        .crypto
        .setup_vault(&password)
        .map_err(|e| e.to_string())?;
    record_last_access(&app);
    store_keychain_if_enabled(&state).await;
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip(state, password, app))]
pub async fn unlock_vault(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    password: String,
) -> Result<(), String> {
    if password.is_empty() {
        return Err("Password cannot be empty".to_string());
    }
    state.crypto.unlock(&password).map_err(|e| e.to_string())?;
    record_last_access(&app);
    store_keychain_if_enabled(&state).await;
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
pub async fn import_synced_vault(
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

    // Salvar token em plaintext ANTES de trocar o vault DEK, enquanto o DEK
    // atual ainda consegue descriptografar github_token.enc.
    let token_before_import: Option<String> = {
        // 1. Tenta memória (in-process)
        let in_memory = crate::handlers::auth::GITHUB_TOKEN
            .lock()
            .unwrap()
            .clone();
        if in_memory.is_some() {
            in_memory
        } else {
            // 2. Tenta disco com DEK atual
            app.path()
                .app_data_dir()
                .ok()
                .and_then(|dir| std::fs::read_to_string(dir.join("github_token.enc")).ok())
                .and_then(|enc| state.crypto.decrypt(&enc).ok())
        }
    };

    let import_result = state
        .crypto
        .import_vault(&payload, &password)
        .map_err(|e| e.to_string());

    if import_result.is_ok() {
        // Re-cifrar token com o novo DEK (se tínhamos um)
        if let Some(token) = token_before_import {
            if let Ok(app_dir) = app.path().app_data_dir() {
                if let Ok(encrypted) = state.crypto.encrypt(&token) {
                    let _ = std::fs::write(app_dir.join("github_token.enc"), encrypted);
                    tracing::info!("GitHub token re-encrypted with new vault DEK after import");
                }
            }
        }
        record_last_access(&app);
        store_keychain_if_enabled(&state).await;
    }

    import_result
}

/// Frequência atual do desbloqueio automático (`always` quando nunca configurada).
#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_unlock_frequency(state: State<'_, AppState>) -> Result<String, String> {
    Ok(read_frequency(&state.db.pool).await)
}

/// Altera a frequência do desbloqueio automático.
/// Voltar para `always` apaga a DEK do keychain (volta a pedir senha sempre).
#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn set_unlock_frequency(
    state: State<'_, AppState>,
    frequency: String,
) -> Result<(), String> {
    if !["always", "week", "month"].contains(&frequency.as_str()) {
        return Err("Frequência inválida. Use always, week ou month.".to_string());
    }
    sqlx::query(
        "INSERT INTO settings (key, value, hlc) VALUES (?, ?, '')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(UNLOCK_FREQUENCY_KEY)
    .bind(&frequency)
    .execute(&state.db.pool)
    .await
    .map_err(|e| e.to_string())?;
    if frequency == "always" {
        CryptoService::clear_keychain();
    } else if state.crypto.is_configured() {
        // Vault desbloqueado agora: salva a DEK já; se bloqueado, salva no unlock
        if let Err(e) = state.crypto.store_dek_in_keychain() {
            tracing::debug!("DEK não salva agora ({}), será salva no unlock", e);
        }
    }
    Ok(())
}

/// Tenta desbloquear o vault sem senha usando a DEK do keychain.
/// Retorna `true` se desbloqueou (ou já estava desbloqueado).
/// Janela deslizante: cada abertura dentro do prazo renova o timestamp.
/// Prazo expirado apaga a entrada do keychain e exige a senha.
#[tauri::command]
#[tracing::instrument(skip(app, state))]
pub async fn try_auto_unlock(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    if !state.crypto.is_configured() {
        return Ok(false);
    }
    if !state.crypto.is_locked() {
        return Ok(true);
    }
    let period = match period_secs(&read_frequency(&state.db.pool).await) {
        Some(p) => p,
        None => return Ok(false),
    };
    let last = match read_last_unlocked_at(&app) {
        Some(t) => t,
        None => return Ok(false),
    };
    if (chrono::Utc::now() - last).num_seconds() > period {
        tracing::info!("Prazo do desbloqueio automático expirou — exigindo senha");
        CryptoService::clear_keychain();
        return Ok(false);
    }
    let dek = match CryptoService::load_dek_from_keychain() {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!("Auto-unlock indisponível: {}", e);
            return Ok(false);
        }
    };
    state
        .crypto
        .unlock_with_dek(dek)
        .map_err(|e| e.to_string())?;
    record_last_access(&app);
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::period_secs;

    #[test]
    fn prazos_em_segundos() {
        assert_eq!(period_secs("week"), Some(7 * 24 * 3600));
        assert_eq!(period_secs("month"), Some(30 * 24 * 3600));
    }

    #[test]
    fn always_e_invalido_sem_prazo() {
        assert_eq!(period_secs("always"), None);
        assert_eq!(period_secs(""), None);
        assert_eq!(period_secs("year"), None);
    }
}
