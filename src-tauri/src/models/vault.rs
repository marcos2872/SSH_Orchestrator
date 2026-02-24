use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct VaultConfig {
    pub salt: String,
    pub encrypted_dek: String,
}
