use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};
use ring::pbkdf2;
use ring::rand::{SecureRandom, SystemRandom};
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;

const KEY_LEN: usize = 32; // AES-256
const SALT_LEN: usize = 16;
const PBKDF2_ITERATIONS: u32 = 100_000;

#[derive(serde::Serialize, serde::Deserialize)]
pub struct VaultConfig {
    pub salt: String,
    pub encrypted_dek: String,
}

pub enum VaultState {
    Unlocked { dek: [u8; KEY_LEN] },
    Locked,
    Unconfigured { dek: [u8; KEY_LEN] }, // MVP fallback
}

pub struct CryptoService {
    app_data_dir: PathBuf,
    state: RwLock<VaultState>,
    rng: SystemRandom,
}

impl CryptoService {
    pub fn new(app_data_dir: &PathBuf) -> Result<Self> {
        let vault_path = app_data_dir.join("vault.json");
        let key_path = app_data_dir.join("app.key");

        let state = if vault_path.exists() {
            tracing::info!("Vault configuration found, starting in Locked state");
            VaultState::Locked
        } else if key_path.exists() {
            tracing::info!("Found legacy app.key, starting in Unconfigured state");
            let raw = fs::read(&key_path)?;
            let array: [u8; KEY_LEN] = raw
                .try_into()
                .map_err(|_| anyhow!("Chave app.key corrompida (tamanho inválido)"))?;
            VaultState::Unconfigured { dek: array }
        } else {
            tracing::info!("No vault or legacy key found, generating temporary DEK");
            let rng = SystemRandom::new();
            let mut key = [0u8; KEY_LEN];
            rng.fill(&mut key)
                .map_err(|_| anyhow!("Falha ao gerar chave aleatória"))?;
            fs::write(&key_path, &key)?;
            VaultState::Unconfigured { dek: key }
        };

        Ok(Self {
            app_data_dir: app_data_dir.clone(),
            state: RwLock::new(state),
            rng: SystemRandom::new(),
        })
    }

    pub fn is_configured(&self) -> bool {
        let state = self.state.read().unwrap();
        matches!(*state, VaultState::Locked | VaultState::Unlocked { .. })
    }

    pub fn is_locked(&self) -> bool {
        let state = self.state.read().unwrap();
        matches!(*state, VaultState::Locked)
    }

    pub fn setup_vault(&self, password: &str) -> Result<()> {
        let mut state = self.state.write().unwrap();

        // Only allow if currently Unconfigured
        let current_dek = match &*state {
            VaultState::Unconfigured { dek } => *dek,
            _ => return Err(anyhow!("Vault is already configured. Cannot override.")),
        };

        // Generate salt
        let mut salt = [0u8; SALT_LEN];
        self.rng
            .fill(&mut salt)
            .map_err(|_| anyhow!("Failed to generate salt"))?;

        // Derive KEK
        let mut kek = [0u8; KEY_LEN];
        pbkdf2::derive(
            pbkdf2::PBKDF2_HMAC_SHA256,
            std::num::NonZeroU32::new(PBKDF2_ITERATIONS).unwrap(),
            &salt,
            password.as_bytes(),
            &mut kek,
        );

        // Encrypt DEK with KEK
        let kek_key = LessSafeKey::new(
            UnboundKey::new(&AES_256_GCM, &kek)
                .map_err(|_| anyhow!("Failed to create KEK AES key"))?,
        );

        let mut nonce_bytes = [0u8; NONCE_LEN];
        self.rng
            .fill(&mut nonce_bytes)
            .map_err(|_| anyhow!("Failed to generate nonce"))?;
        let nonce = Nonce::assume_unique_for_key(nonce_bytes);

        let mut buf = current_dek.to_vec();
        kek_key
            .seal_in_place_append_tag(nonce, Aad::empty(), &mut buf)
            .map_err(|_| anyhow!("Failed to encrypt DEK"))?;

        let mut encrypted_dek_payload = nonce_bytes.to_vec();
        encrypted_dek_payload.extend_from_slice(&buf);

        let config = VaultConfig {
            salt: B64.encode(&salt),
            encrypted_dek: B64.encode(&encrypted_dek_payload),
        };

        let vault_path = self.app_data_dir.join("vault.json");
        fs::write(&vault_path, serde_json::to_string_pretty(&config)?)?;

        // Clean up legacy app.key if it exists
        let key_path = self.app_data_dir.join("app.key");
        if key_path.exists() {
            let _ = fs::remove_file(&key_path);
        }

        *state = VaultState::Unlocked { dek: current_dek };
        tracing::info!("Vault configured successfully");

        Ok(())
    }

    pub fn get_vault_payload(&self) -> Result<String> {
        let vault_path = self.app_data_dir.join("vault.json");
        if vault_path.exists() {
            Ok(fs::read_to_string(&vault_path)?)
        } else {
            Err(anyhow!("Vault not configured yet"))
        }
    }

    pub fn import_vault(&self, payload: &str, password: &str) -> Result<()> {
        let config: VaultConfig =
            serde_json::from_str(payload).map_err(|_| anyhow!("Failed to parse vault payload"))?;

        let salt = B64
            .decode(&config.salt)
            .map_err(|_| anyhow!("Invalid salt base64"))?;
        let encrypted_dek_payload = B64
            .decode(&config.encrypted_dek)
            .map_err(|_| anyhow!("Invalid DEK base64"))?;

        if encrypted_dek_payload.len() < NONCE_LEN + 16 {
            return Err(anyhow!("Encrypted DEK payload too short"));
        }

        // Derive KEK
        let mut kek = [0u8; KEY_LEN];
        pbkdf2::derive(
            pbkdf2::PBKDF2_HMAC_SHA256,
            std::num::NonZeroU32::new(PBKDF2_ITERATIONS).unwrap(),
            &salt,
            password.as_bytes(),
            &mut kek,
        );

        let kek_key = LessSafeKey::new(
            UnboundKey::new(&AES_256_GCM, &kek)
                .map_err(|_| anyhow!("Failed to create KEK AES key"))?,
        );

        let (nonce_slice, ciphertext) = encrypted_dek_payload.split_at(NONCE_LEN);
        let nonce = Nonce::assume_unique_for_key(nonce_slice.try_into().unwrap());

        let mut buf = ciphertext.to_vec();
        let dek_slice = kek_key
            .open_in_place(nonce, Aad::empty(), &mut buf)
            .map_err(|_| anyhow!("Senha incorreta para o Cofre Sincronizado"))?;

        let dek: [u8; KEY_LEN] = dek_slice
            .try_into()
            .map_err(|_| anyhow!("Decrypted DEK size invalid"))?;

        // Senha correta. Salvar payload no lugar.
        let vault_path = self.app_data_dir.join("vault.json");
        fs::write(&vault_path, payload)?;

        // Limpar app.key se existir
        let key_path = self.app_data_dir.join("app.key");
        if key_path.exists() {
            let _ = fs::remove_file(&key_path);
        }

        let mut state = self.state.write().unwrap();
        *state = VaultState::Unlocked { dek };
        tracing::info!("Vault imported and unlocked successfully");

        Ok(())
    }

    pub fn unlock(&self, password: &str) -> Result<()> {
        let mut state = self.state.write().unwrap();

        if !matches!(*state, VaultState::Locked) {
            return Ok(()); // Already unlocked or unconfigured
        }

        let vault_path = self.app_data_dir.join("vault.json");
        let vault_data =
            fs::read_to_string(&vault_path).map_err(|_| anyhow!("Failed to read vault.json"))?;

        let config: VaultConfig =
            serde_json::from_str(&vault_data).map_err(|_| anyhow!("Failed to parse vault.json"))?;

        let salt = B64
            .decode(&config.salt)
            .map_err(|_| anyhow!("Invalid salt base64"))?;
        let encrypted_dek_payload = B64
            .decode(&config.encrypted_dek)
            .map_err(|_| anyhow!("Invalid DEK base64"))?;

        if encrypted_dek_payload.len() < NONCE_LEN + 16 {
            return Err(anyhow!("Encrypted DEK payload too short"));
        }

        // Derive KEK
        let mut kek = [0u8; KEY_LEN];
        pbkdf2::derive(
            pbkdf2::PBKDF2_HMAC_SHA256,
            std::num::NonZeroU32::new(PBKDF2_ITERATIONS).unwrap(),
            &salt,
            password.as_bytes(),
            &mut kek,
        );

        let kek_key = LessSafeKey::new(
            UnboundKey::new(&AES_256_GCM, &kek)
                .map_err(|_| anyhow!("Failed to create KEK AES key"))?,
        );

        let (nonce_slice, ciphertext) = encrypted_dek_payload.split_at(NONCE_LEN);
        let nonce = Nonce::assume_unique_for_key(nonce_slice.try_into().unwrap());

        let mut buf = ciphertext.to_vec();
        let dek_slice = kek_key
            .open_in_place(nonce, Aad::empty(), &mut buf)
            .map_err(|_| anyhow!("Senha incorreta"))?;

        let dek: [u8; KEY_LEN] = dek_slice
            .try_into()
            .map_err(|_| anyhow!("Decrypted DEK size invalid"))?;

        *state = VaultState::Unlocked { dek };
        tracing::info!("Vault unlocked successfully");

        Ok(())
    }

    fn get_dek(&self) -> Result<[u8; KEY_LEN]> {
        let state = self.state.read().unwrap();
        match &*state {
            VaultState::Unlocked { dek } => Ok(*dek),
            VaultState::Unconfigured { dek } => Ok(*dek),
            VaultState::Locked => Err(anyhow!("Vault is locked. Unlock first.")),
        }
    }

    pub fn encrypt(&self, plaintext: &str) -> Result<String> {
        let dek = self.get_dek()?;

        let mut nonce_bytes = [0u8; NONCE_LEN];
        self.rng
            .fill(&mut nonce_bytes)
            .map_err(|_| anyhow!("Falha ao gerar nonce"))?;

        let key = LessSafeKey::new(
            UnboundKey::new(&AES_256_GCM, &dek).map_err(|_| anyhow!("Falha ao criar chave AES"))?,
        );

        let nonce = Nonce::assume_unique_for_key(nonce_bytes);
        let mut buf = plaintext.as_bytes().to_vec();

        key.seal_in_place_append_tag(nonce, Aad::empty(), &mut buf)
            .map_err(|_| anyhow!("Falha ao encriptar"))?;

        let mut output = nonce_bytes.to_vec();
        output.extend_from_slice(&buf);
        Ok(B64.encode(&output))
    }

    pub fn decrypt(&self, encoded: &str) -> Result<String> {
        let dek = self.get_dek()?;

        let raw = B64
            .decode(encoded)
            .map_err(|_| anyhow!("Base64 inválido ao decriptar"))?;

        if raw.len() < NONCE_LEN + 16 {
            return Err(anyhow!("Payload encriptado muito curto"));
        }

        let (nonce_slice, ciphertext) = raw.split_at(NONCE_LEN);
        let nonce = Nonce::assume_unique_for_key(nonce_slice.try_into().unwrap());

        let key = LessSafeKey::new(
            UnboundKey::new(&AES_256_GCM, &dek).map_err(|_| anyhow!("Falha ao criar chave AES"))?,
        );

        let mut buf = ciphertext.to_vec();
        let plaintext = key
            .open_in_place(nonce, Aad::empty(), &mut buf)
            .map_err(|_| anyhow!("Falha ao decriptar: dados corrompidos ou chave inválida"))?;

        String::from_utf8(plaintext.to_vec())
            .map_err(|_| anyhow!("Texto decriptado não é UTF-8 válido"))
    }
}
