use anyhow::Result;
use rand::{distributions::Alphanumeric, Rng};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use url::Url;

// GitHub OAuth configuration will be loaded from environment variables

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct GitHubUser {
    pub login: String,
    pub name: Option<String>,
    pub avatar_url: String,
    pub email: Option<String>,
    pub html_url: String,
}

#[derive(Deserialize, Debug)]
struct TokenResponse {
    access_token: String,
    #[serde(rename = "token_type")]
    _token_type: String,
    #[serde(rename = "scope")]
    _scope: String,
}

pub async fn start_oauth_flow() -> Result<String> {
    // 1. Generate state
    let state: String = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(16)
        .map(char::from)
        .collect();

    // 2. Start a local server to receive the callback
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let redirect_uri = format!("http://localhost:{}/callback", port);

    // 3. Construct OAuth URL
    let auth_url_str = "https://github.com/login/oauth/authorize".to_string();

    let client_id = env!("GH_CLIENT_ID").trim().to_string();

    tracing::info!(
        "Starting OAuth flow with client_id length: {}",
        client_id.len()
    );

    let mut auth_url = Url::parse(&auth_url_str)?;
    auth_url
        .query_pairs_mut()
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("scope", "repo user:email")
        .append_pair("state", &state);

    // 4. Open browser
    open::that(auth_url.as_str())?;

    // 5. Wait for callback
    let (mut stream, _) = listener.accept().await?;
    let mut buffer = [0; 2048];
    let n = stream.read(&mut buffer).await?;
    let request = String::from_utf8_lossy(&buffer[..n]);

    let mut code = String::new();
    let mut returned_state = String::new();

    if let Some(first_line) = request.lines().next() {
        if first_line.starts_with("GET /callback?") {
            let url_part = first_line.split(' ').nth(1).unwrap_or("");
            if let Ok(url) = Url::parse(&format!("http://localhost{}", url_part)) {
                for (key, value) in url.query_pairs() {
                    if key == "code" {
                        code = value.into_owned();
                    } else if key == "state" {
                        returned_state = value.into_owned();
                    }
                }
            }
        }
    }

    let response_body = r#"
        <!DOCTYPE html>
        <html lang='en'>
        <head>
            <meta charset='UTF-8'>
            <meta name='viewport' content='width=device-width, initial-scale=1.0'>
            <title>Auth Successful - SSH Config Sync</title>
            <style>
                body { 
                    background-color: #0f172a; 
                    color: #f8fafc; 
                    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100vh;
                    margin: 0;
                }
                .card {
                    background: rgba(30, 41, 59, 0.5);
                    border: 1px solid #334155;
                    padding: 2.5rem;
                    border-radius: 1rem;
                    text-align: center;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
                    backdrop-filter: blur(8px);
                    max-width: 400px;
                }
                .icon {
                    color: #10b981;
                    font-size: 3rem;
                    margin-bottom: 1rem;
                }
                h1 {
                    font-size: 1.5rem;
                    font-weight: 600;
                    margin-bottom: 0.5rem;
                }
                p {
                    color: #94a3b8;
                    font-size: 0.875rem;
                    line-height: 1.5;
                }
            </style>
        </head>
        <body>
            <div class='card'>
                <div class='icon'>✨</div>
                <h1>Authentication Successful!</h1>
                <p>You have successfully logged in via GitHub. You can safely close this window and return to the SSH Config Sync application.</p>
            </div>
            <script>
                setTimeout(() => {
                    window.close();
                }, 3000);
            </script>
        </body>
        </html>
    "#;
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        response_body.len(),
        response_body
    );
    stream.write_all(response.as_bytes()).await?;

    if returned_state != state {
        return Err(anyhow::anyhow!("State mismatch. Potential CSRF attack."));
    }
    if code.is_empty() {
        return Err(anyhow::anyhow!("No code received"));
    }

    // 6. Exchange code for access token
    let client = Client::new();
    let token_url = "https://github.com/login/oauth/access_token".to_string();

    let client_id = env!("GH_CLIENT_ID").trim().to_string();
    let client_secret = env!("GH_CLIENT_SECRET").trim().to_string();

    tracing::info!("Exchanging code for token at: {}", token_url);

    let token_res: reqwest::Response = client
        .post(token_url)
        .header("Accept", "application/json")
        .form(&[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("code", &code),
            ("redirect_uri", &redirect_uri),
        ])
        .send()
        .await?;

    if token_res.status() != StatusCode::OK {
        let status = token_res.status();
        let body = token_res
            .text()
            .await
            .unwrap_or_else(|_| "Could not read body".to_string());
        tracing::error!(
            "Failed to exchange token. Status: {}, Body: {}",
            status,
            body
        );
        return Err(anyhow::anyhow!("Failed to exchange token: {}", status));
    }

    let token_data: TokenResponse = token_res.json().await.map_err(|e| {
        tracing::error!("Failed to decode TokenResponse: {}", e);
        anyhow::anyhow!("Failed to decode response: {}", e)
    })?;

    Ok(token_data.access_token)
}

pub async fn get_user(token: &str) -> Result<GitHubUser> {
    let client = Client::new();
    let res: reqwest::Response = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {}", token))
        .header("User-Agent", "ssh-config-sync")
        .send()
        .await?;

    if !res.status().is_success() {
        return Err(anyhow::anyhow!(
            "Failed to fetch user data: {}",
            res.status()
        ));
    }

    let user: GitHubUser = res.json().await?;
    Ok(user)
}
