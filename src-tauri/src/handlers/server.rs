use crate::sync::crdt::HLC;
use crate::AppState;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn get_servers(
    state: State<'_, AppState>,
    workspace_id: String,
) -> Result<Vec<crate::models::Server>, String> {
    let ws_uuid = Uuid::parse_str(&workspace_id).map_err(|e| e.to_string())?;
    let rows = sqlx::query_as::<_, crate::models::ServerRow>(
        "SELECT * FROM servers WHERE workspace_id = ? AND deleted = 0",
    )
    .bind(ws_uuid)
    .fetch_all(&state.db.pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(rows.into_iter().map(|r| r.into_server()).collect())
}

/// Create a server with optional credentials.
///
/// - `password` + `save_password`: SSH password auth, encrypted with vault DEK.
/// - `ssh_key` + `save_ssh_key`: PEM private key, encrypted with vault DEK.
/// - `ssh_key_passphrase` + `save_ssh_key_passphrase`: optional key passphrase.
/// - `auth_method`: "password" or "ssh_key" — controls which prompt is shown at connect-time.
///
/// Raw credential values are NEVER stored — only their AES-256-GCM encrypted forms.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
#[tracing::instrument(skip(state, password, ssh_key, ssh_key_passphrase))]
pub async fn create_server(
    state: State<'_, AppState>,
    workspace_id: String,
    name: String,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    save_password: bool,
    ssh_key: Option<String>,
    save_ssh_key: bool,
    ssh_key_passphrase: Option<String>,
    save_ssh_key_passphrase: bool,
    auth_method: String,
) -> Result<crate::models::Server, String> {
    // ── Encrypt password ───────────────────────────────────────────────────
    let password_enc: Option<String> = if save_password {
        match password.as_deref() {
            Some(pw) if !pw.is_empty() => {
                Some(state.crypto.encrypt(pw).map_err(|e| e.to_string())?)
            }
            _ => None,
        }
    } else {
        None
    };

    // ── Encrypt SSH private key ────────────────────────────────────────────
    let ssh_key_enc: Option<String> = if save_ssh_key {
        match ssh_key.as_deref() {
            Some(k) if !k.is_empty() => Some(state.crypto.encrypt(k).map_err(|e| e.to_string())?),
            _ => None,
        }
    } else {
        None
    };

    // ── Encrypt SSH key passphrase ─────────────────────────────────────────
    let ssh_key_passphrase_enc: Option<String> = if save_ssh_key_passphrase && ssh_key_enc.is_some()
    {
        match ssh_key_passphrase.as_deref() {
            Some(p) if !p.is_empty() => Some(state.crypto.encrypt(p).map_err(|e| e.to_string())?),
            _ => None,
        }
    } else {
        None
    };

    let hlc = HLC::now(&state.node_id);

    let server = crate::models::Server {
        id: Uuid::new_v4(),
        workspace_id: Uuid::parse_str(&workspace_id).map_err(|e| e.to_string())?,
        name,
        host,
        port,
        username,
        tags: vec![],
        folder_color: None,
        has_saved_password: password_enc.is_some(),
        has_saved_ssh_key: ssh_key_enc.is_some(),
        has_saved_ssh_key_passphrase: ssh_key_passphrase_enc.is_some(),
        auth_method,
        hlc: hlc.to_string_repr(),
        deleted: false,
    };

    let tags_json = serde_json::to_string(&server.tags).map_err(|e| e.to_string())?;

    sqlx::query(
        "INSERT INTO servers \
         (id, workspace_id, name, host, port, username, tags, password_enc, ssh_key_enc, ssh_key_passphrase_enc, auth_method, hlc, deleted) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
    )
    .bind(server.id)
    .bind(server.workspace_id)
    .bind(&server.name)
    .bind(&server.host)
    .bind(server.port)
    .bind(&server.username)
    .bind(tags_json)
    .bind(&password_enc)
    .bind(&ssh_key_enc)
    .bind(&ssh_key_passphrase_enc)
    .bind(&server.auth_method)
    .bind(&server.hlc)
    .execute(&state.db.pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(server)
}

/// Update server metadata and optionally rotate credentials.
///
/// For each credential type, passing `save_*: false` clears the saved value.
/// Passing `save_*: true` with a non-empty value rotates it.
/// Passing `save_*: true` with `None` or empty string preserves the existing value.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
#[tracing::instrument(skip(state, password, ssh_key, ssh_key_passphrase))]
pub async fn update_server(
    state: State<'_, AppState>,
    id: String,
    name: String,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    save_password: bool,
    ssh_key: Option<String>,
    save_ssh_key: bool,
    ssh_key_passphrase: Option<String>,
    save_ssh_key_passphrase: bool,
    auth_method: String,
) -> Result<(), String> {
    let srv_id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;

    // ── Load existing encrypted values (to preserve when not replaced) ─────
    let existing: (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
        "SELECT password_enc, ssh_key_enc, ssh_key_passphrase_enc FROM servers WHERE id = ?",
    )
    .bind(srv_id)
    .fetch_one(&state.db.pool)
    .await
    .map_err(|e| e.to_string())?;

    let (existing_pw_enc, existing_key_enc, existing_passphrase_enc) = existing;

    // ── Resolve new password_enc ───────────────────────────────────────────
    let password_enc: Option<String> = if save_password {
        match password.as_deref() {
            Some(pw) if !pw.is_empty() => {
                // New password provided — encrypt and replace
                Some(state.crypto.encrypt(pw).map_err(|e| e.to_string())?)
            }
            _ => {
                // save_password=true but no new password — preserve existing
                existing_pw_enc
            }
        }
    } else {
        // save_password=false — clear
        None
    };

    // ── Resolve new ssh_key_enc ────────────────────────────────────────────
    let ssh_key_enc: Option<String> = if save_ssh_key {
        match ssh_key.as_deref() {
            Some(k) if !k.is_empty() => Some(state.crypto.encrypt(k).map_err(|e| e.to_string())?),
            _ => existing_key_enc,
        }
    } else {
        None
    };

    // ── Resolve new ssh_key_passphrase_enc ────────────────────────────────
    let ssh_key_passphrase_enc: Option<String> = if save_ssh_key_passphrase && ssh_key_enc.is_some()
    {
        match ssh_key_passphrase.as_deref() {
            Some(p) if !p.is_empty() => Some(state.crypto.encrypt(p).map_err(|e| e.to_string())?),
            _ => existing_passphrase_enc,
        }
    } else if ssh_key_enc.is_none() {
        // Key was cleared — clear passphrase too
        None
    } else {
        None
    };

    let hlc = HLC::now(&state.node_id).to_string_repr();

    sqlx::query(
        "UPDATE servers \
         SET name = ?, host = ?, port = ?, username = ?, password_enc = ?, \
             ssh_key_enc = ?, ssh_key_passphrase_enc = ?, auth_method = ?, hlc = ? \
         WHERE id = ?",
    )
    .bind(&name)
    .bind(&host)
    .bind(port)
    .bind(&username)
    .bind(&password_enc)
    .bind(&ssh_key_enc)
    .bind(&ssh_key_passphrase_enc)
    .bind(&auth_method)
    .bind(&hlc)
    .bind(srv_id)
    .execute(&state.db.pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub async fn delete_server(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let srv_id = Uuid::parse_str(&id).map_err(|e| e.to_string())?;
    let hlc = HLC::now(&state.node_id).to_string_repr();
    sqlx::query("UPDATE servers SET deleted = 1, hlc = ? WHERE id = ?")
        .bind(&hlc)
        .bind(srv_id)
        .execute(&state.db.pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
