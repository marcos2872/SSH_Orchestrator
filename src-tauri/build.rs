fn main() {
    // Load .env file and propagate variables to the compiler
    if let Ok(path) = dotenvy::dotenv() {
        println!("cargo:rerun-if-changed={}", path.display());
    }
    
    // Fallback to empty values if not present (build will still succeed but OAuth won't work)
    let client_id = std::env::var("GH_CLIENT_ID").unwrap_or_default();
    let client_secret = std::env::var("GH_CLIENT_SECRET").unwrap_or_default();
    
    println!("cargo:rustc-env=GH_CLIENT_ID={}", client_id);
    println!("cargo:rustc-env=GH_CLIENT_SECRET={}", client_secret);

    tauri_build::build()
}
