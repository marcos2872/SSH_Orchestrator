use crate::auth::github::{self, GitHubUser};
use serde::Serialize;
use std::sync::Mutex;
use tauri::Manager;
lazy_static::lazy_static! {
    /// Token OAuth do GitHub em memória para re-cifragem no import_vault.
    /// A fonte canônica é `github_token.enc` em disco; este campo é populado
    /// após login e usado quando o vault é reimportado na mesma sessão.
    pub(crate) static ref GITHUB_TOKEN: Mutex<Option<String>> = Mutex::new(None);
}

#[derive(Serialize)]
pub struct AuthResponse {
    user: GitHubUser,
}

pub fn reencrypt_token(app: &tauri::AppHandle, state: &tauri::State<'_, crate::AppState>) {
    let token_opt = {
        let guard = GITHUB_TOKEN.lock().unwrap();
        guard.clone()
    };

    if let Some(token) = token_opt {
        if let Ok(encrypted) = state.crypto.encrypt(&token) {
            if let Ok(app_dir) = app.path().app_data_dir() {
                let _ = std::fs::write(app_dir.join("github_token.enc"), encrypted);
                tracing::info!("GitHub token re-encrypted with new vault DEK");
            }
        }
    }
}

#[tauri::command]
#[tracing::instrument(skip(state, app))]
pub async fn github_login(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<AuthResponse, String> {
    tracing::info!("github_login: Command invoked");
    // Em uma aplicação real, salvaríamos o access token na storage cifrada (Vault)
    match github::start_oauth_flow().await {
        Ok(token) => {
            {
                let mut guard = GITHUB_TOKEN.lock().unwrap();
                *guard = Some(token.clone());
            } // unlock before await

            if let Ok(encrypted) = state.crypto.encrypt(&token) {
                if let Ok(app_dir) = app.path().app_data_dir() {
                    let _ = std::fs::write(app_dir.join("github_token.enc"), encrypted);
                }
            }

            match github::get_user(&token).await {
                Ok(user) => {
                    // Após login com sucesso, garantir que o repo de sync exista (provisionamento)
                    if let Err(repo_err) = crate::sync::repo::ensure_sync_repo_exists(&token).await
                    {
                        tracing::error!("Failed to ensure sync repo exists: {}", repo_err);
                        // Não falhamos o login, apenas logamos o erro (para retry posterior)
                    } else {
                        tracing::info!("Sync repo exists, running initial sync...");
                        if let Err(sync_err) =
                            crate::sync::pull_workspace(app.clone(), state, Some(token.clone()))
                                .await
                        {
                            tracing::error!("Failed to run initial pull: {}", sync_err);
                        }
                    }
                    Ok(AuthResponse { user })
                }
                Err(e) => Err(format!("Falha ao buscar usuário do GitHub: {}", e)),
            }
        }
        Err(e) => Err(format!("Falha na autenticação OAuth: {}", e)),
    }
}

#[tauri::command]
#[tracing::instrument(skip(state, app))]
pub async fn get_current_user(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::AppState>,
) -> Result<Option<AuthResponse>, String> {
    if let Ok(app_dir) = app.path().app_data_dir() {
        let token_path = app_dir.join("github_token.enc");
        if let Ok(encrypted) = std::fs::read_to_string(&token_path) {
            if let Ok(token) = state.crypto.decrypt(&encrypted) {
                // Pre-populate in-memory token
                {
                    let mut guard = GITHUB_TOKEN.lock().unwrap();
                    *guard = Some(token.clone());
                }
                match github::get_user(&token).await {
                    Ok(user) => {
                        println!("Token valid, getting current user. Running background sync...");
                        // Also trigger a background sync so workspaces populate on load
                        if let Err(sync_err) =
                            crate::sync::pull_workspace(app.clone(), state, None).await
                        {
                            tracing::warn!("Failed to run startup pull: {}", sync_err);
                        }
                        return Ok(Some(AuthResponse { user }));
                    }
                    Err(_) => return Ok(None),
                }
            }
        }
    }
    Ok(None)
}

#[tauri::command]
#[tracing::instrument(skip(app))]
pub async fn github_logout(app: tauri::AppHandle) -> Result<(), String> {
    let token_opt = {
        let guard = GITHUB_TOKEN.lock().unwrap();
        guard.clone()
    };

    // Revogar token no servidor GitHub (best-effort; não falha o logout se der erro)
    if let Some(token) = token_opt {
        let client_id = env!("GH_CLIENT_ID").trim();
        let client = reqwest::Client::new();
        let _ = client
            .delete(format!(
                "https://api.github.com/applications/{}/token",
                client_id
            ))
            .basic_auth(client_id, Some(env!("GH_CLIENT_SECRET").trim()))
            .json(&serde_json::json!({ "access_token": token }))
            .header("User-Agent", "ssh-config-sync")
            .send()
            .await;
    }

    {
        let mut guard = GITHUB_TOKEN.lock().unwrap();
        *guard = None;
    }
    if let Ok(app_dir) = app.path().app_data_dir() {
        let _ = std::fs::remove_file(app_dir.join("github_token.enc"));
    }
    Ok(())
}
