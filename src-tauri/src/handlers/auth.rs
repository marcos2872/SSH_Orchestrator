use crate::auth::github::{self, GitHubUser};
use serde::Serialize;
use std::sync::Mutex;

lazy_static::lazy_static! {
    // Basic in-memory state for token just for testing, in a real app this should be stored securely
    static ref GITHUB_TOKEN: Mutex<Option<String>> = Mutex::new(None);
}

#[derive(Serialize)]
pub struct AuthResponse {
    user: GitHubUser,
}

#[tauri::command]
pub async fn github_login() -> Result<AuthResponse, String> {
    // Em uma aplicação real, salvaríamos o access token na storage cifrada (Vault)
    match github::start_oauth_flow().await {
        Ok(token) => {
            {
                let mut guard = GITHUB_TOKEN.lock().unwrap();
                *guard = Some(token.clone());
            } // unlock before await
            
            match github::get_user(&token).await {
                Ok(user) => {
                    // Após login com sucesso, garantir que o repo de sync exista (provisionamento)
                    if let Err(repo_err) = crate::sync::repo::ensure_sync_repo_exists(&token).await {
                        println!("Failed to ensure sync repo exists: {}", repo_err);
                        // Não falhamos o login, apenas logamos o erro (para retry posterior)
                    }
                    Ok(AuthResponse { user })
                },
                Err(e) => Err(format!("Falha ao buscar usuário do GitHub: {}", e)),
            }
        },
        Err(e) => Err(format!("Falha na autenticação OAuth: {}", e)),
    }
}
