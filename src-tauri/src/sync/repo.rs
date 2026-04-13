use anyhow::Result;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};

const REPO_NAME: &str = "ssh-config-sync-data";

#[derive(Serialize)]
struct CreateRepoRequest {
    name: String,
    description: String,
    private: bool,
    auto_init: bool,
}

#[derive(Deserialize, Debug)]
pub struct RepoInfo {
    pub name: String,
    pub clone_url: String,
    pub ssh_url: String,
}

pub async fn ensure_sync_repo_exists(token: &str) -> Result<RepoInfo> {
    tracing::info!("ensure_sync_repo_exists: Function entered");
    let client = Client::new();

    tracing::info!("ensure_sync_repo_exists: Checking if user repo exists at GitHub...");
    // 1. Check if repo exists
    let user_res = match super::super::auth::github::get_user(token).await {
        Ok(u) => u,
        Err(e) => {
            tracing::error!("ensure_sync_repo_exists: Failed to get user: {}", e);
            return Err(e);
        }
    };
    let repo_url = format!(
        "https://api.github.com/repos/{}/{}",
        user_res.login, REPO_NAME
    );
    tracing::info!(
        "ensure_sync_repo_exists: Requesting repo info from {}",
        repo_url
    );

    let get_res = client
        .get(&repo_url)
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "ssh-config-sync")
        .send()
        .await?;

    tracing::info!(
        "ensure_sync_repo_exists: GitHub response status: {}",
        get_res.status()
    );

    if get_res.status() == StatusCode::OK {
        let repo: RepoInfo = get_res.json().await?;
        return Ok(repo);
    }

    if get_res.status() != StatusCode::NOT_FOUND {
        return Err(anyhow::anyhow!(
            "Failed to check repository: {}",
            get_res.status()
        ));
    }

    // 2. Create the repository
    let create_req = CreateRepoRequest {
        name: REPO_NAME.to_string(),
        description: "Private storage for SSH Config Sync data. Do not modify manually."
            .to_string(),
        private: true,
        auto_init: true, // Creates an initial commit with a README
    };

    let create_res = client
        .post("https://api.github.com/user/repos")
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "ssh-config-sync")
        .json(&create_req)
        .send()
        .await?;

    if !create_res.status().is_success() {
        return Err(anyhow::anyhow!(
            "Failed to create repository: {}",
            create_res.status()
        ));
    }

    let new_repo: RepoInfo = create_res.json().await?;
    Ok(new_repo)
}
