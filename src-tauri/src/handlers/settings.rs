use crate::AppState;
use tauri::State;

/// Lê uma preferência pelo nome da chave.
/// Retorna `None` se a chave ainda não foi salva.
#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_setting(
    key: String,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?")
        .bind(&key)
        .fetch_optional(&state.db.pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(row.map(|(v,)| v))
}

/// Cria ou atualiza uma preferência (upsert).
#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn set_setting(
    key: String,
    value: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO settings (key, value, hlc) VALUES (?, ?, '')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(&key)
    .bind(&value)
    .execute(&state.db.pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}
