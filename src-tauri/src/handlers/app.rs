use serde::{Deserialize, Serialize};
use std::time::Duration;

const REPO: &str = "marcos2872/SSH_Orchestrator";
const FALLBACK_RELEASES_URL: &str = "https://github.com/marcos2872/SSH_Orchestrator/releases";

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AppUpdateInfo {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub update_available: bool,
    pub release_url: String,
}

#[derive(Deserialize, Debug)]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
}

/// Compara duas versões semver (sem o `v` inicial).
/// Retorna true se `latest` for maior que `current`.
fn is_newer(current: &str, latest_tag: &str) -> bool {
    let parse = |v: &str| {
        v.trim_start_matches('v')
            .split('.')
            .map(|p| p.parse::<u64>().unwrap_or(0))
            .collect::<Vec<_>>()
    };
    let current = parse(current);
    let latest = parse(latest_tag);
    let len = current.len().max(latest.len());
    for i in 0..len {
        let c = current.get(i).copied().unwrap_or(0);
        let l = latest.get(i).copied().unwrap_or(0);
        if l != c {
            return l > c;
        }
    }
    false
}

fn no_update(current: String) -> AppUpdateInfo {
    AppUpdateInfo {
        current_version: current,
        latest_version: None,
        update_available: false,
        release_url: FALLBACK_RELEASES_URL.to_string(),
    }
}

/// Verifica se há uma release nova no GitHub.
/// Nunca falha para o frontend: qualquer erro vira "sem update".
#[tauri::command]
#[tracing::instrument]
pub async fn check_app_update(app: tauri::AppHandle) -> Result<AppUpdateInfo, String> {
    let current = app.package_info().version.to_string();

    let client = reqwest::Client::builder()
        .user_agent("ssh-orchestrator")
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("https://api.github.com/repos/{REPO}/releases/latest");
    let release = match client.get(&url).send().await {
        Ok(resp) => match resp.json::<GitHubRelease>().await {
            Ok(release) => release,
            Err(e) => {
                tracing::warn!("Resposta de release inválida: {e}");
                return Ok(no_update(current));
            }
        },
        Err(e) => {
            tracing::warn!("Falha ao consultar releases: {e}");
            return Ok(no_update(current));
        }
    };

    if is_newer(&current, &release.tag_name) {
        Ok(AppUpdateInfo {
            current_version: current,
            latest_version: Some(release.tag_name),
            update_available: true,
            release_url: release.html_url,
        })
    } else {
        Ok(no_update(current))
    }
}

#[cfg(test)]
mod tests {
    use super::is_newer;

    #[test]
    fn detecta_versao_nova() {
        assert!(is_newer("0.1.5", "v0.1.6"));
        assert!(is_newer("0.1.5", "v0.2.0"));
        assert!(is_newer("0.1.5", "v1.0.0"));
    }

    #[test]
    fn ignora_versao_igual_ou_antiga() {
        assert!(!is_newer("0.1.5", "v0.1.5"));
        assert!(!is_newer("0.1.6", "v0.1.5"));
        assert!(!is_newer("1.0.0", "v0.9.9"));
    }
}
