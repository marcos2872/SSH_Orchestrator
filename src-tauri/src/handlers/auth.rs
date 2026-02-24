use crate::auth::github::{self, GitHubUser};
use serde::Serialize;
use std::sync::Mutex;
use tauri::Manager;
lazy_static::lazy_static! {
    // Basic in-memory state for token just for testing, in a real app this should be stored securely
    static ref GITHUB_TOKEN: Mutex<Option<String>> = Mutex::new(None);
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
pub async fn github_login(app: tauri::AppHandle, state: tauri::State<'_, crate::AppState>) -> Result<AuthResponse, String> {
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
                    if let Err(repo_err) = crate::sync::repo::ensure_sync_repo_exists(&token).await {
                        tracing::error!("Failed to ensure sync repo exists: {}", repo_err);
                        // Não falhamos o login, apenas logamos o erro (para retry posterior)
                    } else {
                        tracing::info!("Sync repo exists, running initial sync...");
                        if let Err(sync_err) = crate::sync::pull_workspace(app.clone(), state, "".to_string(), Some(token.clone())).await {
                            tracing::error!("Failed to run initial pull: {}", sync_err);
                        }
                    }
                    Ok(AuthResponse { user })
                },
                Err(e) => Err(format!("Falha ao buscar usuário do GitHub: {}", e)),
            }
        },
        Err(e) => Err(format!("Falha na autenticação OAuth: {}", e)),
    }
}

#[tauri::command]
pub async fn get_current_user(app: tauri::AppHandle, state: tauri::State<'_, crate::AppState>) -> Result<Option<AuthResponse>, String> {
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
                        if let Err(sync_err) = crate::sync::pull_workspace(app.clone(), state, "".to_string(), None).await {
                            println!("Failed to run startup pull: {}", sync_err);
                        }
                        return Ok(Some(AuthResponse { user }));
                    },
                    Err(_) => return Ok(None),
                }
            }
        }
    }
    Ok(None)
}

#[tauri::command]
pub async fn github_logout(app: tauri::AppHandle) -> Result<(), String> {
    {
        let mut guard = GITHUB_TOKEN.lock().unwrap();
        *guard = None;
    }
    if let Ok(app_dir) = app.path().app_data_dir() {
        let _ = std::fs::remove_file(app_dir.join("github_token.enc"));
    }
    Ok(())
}
