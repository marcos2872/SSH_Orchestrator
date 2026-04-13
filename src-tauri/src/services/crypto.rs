use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};
use ring::pbkdf2;
use ring::rand::{SecureRandom, SystemRandom};
use std::fs;
use std::path::{Path, PathBuf};
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
    pub fn new(app_data_dir: &Path) -> Result<Self> {
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
            fs::write(&key_path, key)?;
            VaultState::Unconfigured { dek: key }
        };

        Ok(Self {
            app_data_dir: app_data_dir.to_path_buf(),
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
            salt: B64.encode(salt),
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

#[cfg(test)]
mod tests {
    use super::*;

    // ── Helpers ─────────────────────────────────────────────────────────────

    /// Cria um diretório temporário único e o remove automaticamente ao sair de escopo.
    struct TempDir(std::path::PathBuf);

    impl TempDir {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("crypto_test_{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).expect("falha ao criar diretório de teste");
            Self(dir)
        }

        fn path(&self) -> &std::path::Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    // ── Estado inicial ───────────────────────────────────────────────────────

    #[test]
    fn test_novo_vault_comeca_unconfigured() {
        let dir = TempDir::new();
        let svc = CryptoService::new(dir.path()).unwrap();
        assert!(
            !svc.is_configured(),
            "sem vault.json deve estar Unconfigured"
        );
        assert!(!svc.is_locked(), "Unconfigured não está Locked");
    }

    #[test]
    fn test_novo_vault_cria_app_key() {
        let dir = TempDir::new();
        let _ = CryptoService::new(dir.path()).unwrap();
        assert!(
            dir.path().join("app.key").exists(),
            "app.key deve ser criado em estado Unconfigured"
        );
    }

    #[test]
    fn test_inicia_locked_quando_vault_json_existe() {
        let dir = TempDir::new();
        // Cria vault.json mínimo para simular vault já configurado
        let cfg = VaultConfig {
            salt: base64::engine::general_purpose::STANDARD.encode([0u8; 16]),
            encrypted_dek: base64::engine::general_purpose::STANDARD.encode([0u8; 48]),
        };
        std::fs::write(
            dir.path().join("vault.json"),
            serde_json::to_string(&cfg).unwrap(),
        )
        .unwrap();

        let svc = CryptoService::new(dir.path()).unwrap();
        assert!(svc.is_configured(), "com vault.json deve estar configurado");
        assert!(svc.is_locked(), "com vault.json deve iniciar Locked");
    }

    // ── Encrypt / Decrypt ────────────────────────────────────────────────────

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let dir = TempDir::new();
        let svc = CryptoService::new(dir.path()).unwrap();
        let plaintext = "senha_super_secreta_123!@#";
        let enc = svc.encrypt(plaintext).unwrap();
        assert_ne!(enc, plaintext, "ciphertext não pode ser igual ao plaintext");
        let dec = svc.decrypt(&enc).unwrap();
        assert_eq!(dec, plaintext);
    }

    #[test]
    fn test_encrypt_gera_nonces_diferentes_por_chamada() {
        let dir = TempDir::new();
        let svc = CryptoService::new(dir.path()).unwrap();
        let c1 = svc.encrypt("mesmo texto").unwrap();
        let c2 = svc.encrypt("mesmo texto").unwrap();
        assert_ne!(
            c1, c2,
            "nonces aleatórios devem produzir ciphertexts distintos"
        );
    }

    #[test]
    fn test_encrypt_string_vazia() {
        let dir = TempDir::new();
        let svc = CryptoService::new(dir.path()).unwrap();
        let enc = svc.encrypt("").unwrap();
        assert_eq!(svc.decrypt(&enc).unwrap(), "");
    }

    #[test]
    fn test_encrypt_unicode() {
        let dir = TempDir::new();
        let svc = CryptoService::new(dir.path()).unwrap();
        let plaintext = "senha: 🔑 café naïve 中文 العربية";
        let enc = svc.encrypt(plaintext).unwrap();
        assert_eq!(svc.decrypt(&enc).unwrap(), plaintext);
    }

    #[test]
    fn test_decrypt_falha_com_dados_adulterados() {
        let dir = TempDir::new();
        let svc = CryptoService::new(dir.path()).unwrap();
        let enc = svc.encrypt("dados originais").unwrap();
        // Adultera o último caractere base64
        let mut adulterado = enc.clone();
        let ultimo = adulterado.pop().unwrap_or('A');
        adulterado.push(if ultimo == 'A' { 'B' } else { 'A' });
        assert!(
            svc.decrypt(&adulterado).is_err(),
            "dados adulterados devem falhar na decriptação (GCM auth tag)"
        );
    }

    #[test]
    fn test_decrypt_falha_com_base64_invalido() {
        let dir = TempDir::new();
        let svc = CryptoService::new(dir.path()).unwrap();
        assert!(svc.decrypt("!!!nao_e_base64!!!").is_err());
    }

    #[test]
    fn test_decrypt_falha_com_payload_curto() {
        let dir = TempDir::new();
        let svc = CryptoService::new(dir.path()).unwrap();
        // Menos de NONCE_LEN (12) + 16 bytes = 28 bytes mínimos
        let curto = base64::engine::general_purpose::STANDARD.encode([0u8; 10]);
        assert!(svc.decrypt(&curto).is_err());
    }

    // ── Setup Vault ──────────────────────────────────────────────────────────

    #[test]
    fn test_setup_vault_transiciona_para_unlocked() {
        let dir = TempDir::new();
        let svc = CryptoService::new(dir.path()).unwrap();
        assert!(!svc.is_configured());

        svc.setup_vault("master_password_forte!123").unwrap();

        assert!(svc.is_configured(), "deve estar configurado após setup");
        assert!(!svc.is_locked(), "deve estar Unlocked logo após setup");
        assert!(
            dir.path().join("vault.json").exists(),
            "vault.json deve ser criado"
        );
    }

    #[test]
    fn test_setup_vault_remove_app_key() {
        let dir = TempDir::new();
        let svc = CryptoService::new(dir.path()).unwrap();
        assert!(dir.path().join("app.key").exists());

        svc.setup_vault("senha").unwrap();
        assert!(
            !dir.path().join("app.key").exists(),
            "app.key deve ser removido após setup_vault"
        );
    }

    #[test]
    fn test_setup_vault_falha_quando_ja_configurado() {
        let dir = TempDir::new();
        let svc = CryptoService::new(dir.path()).unwrap();
        svc.setup_vault("senha_inicial").unwrap();
        assert!(
            svc.setup_vault("outra_senha").is_err(),
            "não pode reconfigurar vault já configurado"
        );
    }

    #[test]
    fn test_encrypt_decrypt_apos_setup_vault() {
        let dir = TempDir::new();
        let svc = CryptoService::new(dir.path()).unwrap();
        svc.setup_vault("minha_master_password").unwrap();

        let plaintext = "credencial_apos_setup";
        let enc = svc.encrypt(plaintext).unwrap();
        assert_eq!(svc.decrypt(&enc).unwrap(), plaintext);
    }

    // ── Unlock ───────────────────────────────────────────────────────────────

    #[test]
    fn test_unlock_com_senha_correta() {
        let dir = TempDir::new();
        let svc = CryptoService::new(dir.path()).unwrap();
        svc.setup_vault("senha_correta").unwrap();

        // Nova instância simula reinício do app (começa Locked)
        let svc2 = CryptoService::new(dir.path()).unwrap();
        assert!(svc2.is_locked());
        svc2.unlock("senha_correta").unwrap();
        assert!(!svc2.is_locked());
    }

    #[test]
    fn test_unlock_falha_com_senha_errada() {
        let dir = TempDir::new();
        let svc = CryptoService::new(dir.path()).unwrap();
        svc.setup_vault("senha_certa").unwrap();

        let svc2 = CryptoService::new(dir.path()).unwrap();
        assert!(
            svc2.unlock("senha_errada").is_err(),
            "senha incorreta deve retornar erro"
        );
        assert!(
            svc2.is_locked(),
            "vault deve permanecer Locked após senha errada"
        );
    }

    #[test]
    fn test_unlock_noop_quando_unconfigured() {
        // Documenta comportamento atual: unlock() retorna Ok() se Unconfigured,
        // sem verificar senha — qualquer senha é aceita silenciosamente.
        let dir = TempDir::new();
        let svc = CryptoService::new(dir.path()).unwrap();
        assert!(!svc.is_configured());
        assert!(
            svc.unlock("qualquer_senha_aceita").is_ok(),
            "unlock() em Unconfigured retorna Ok (comportamento atual — não verifica senha)"
        );
    }

    #[test]
    fn test_encrypt_falha_quando_locked() {
        let dir = TempDir::new();
        let svc = CryptoService::new(dir.path()).unwrap();
        svc.setup_vault("senha").unwrap();

        let svc2 = CryptoService::new(dir.path()).unwrap();
        assert!(svc2.is_locked());
        assert!(
            svc2.encrypt("segredo").is_err(),
            "encrypt() deve falhar com vault Locked"
        );
    }

    #[test]
    fn test_decrypt_falha_quando_locked() {
        let dir = TempDir::new();
        let svc = CryptoService::new(dir.path()).unwrap();
        svc.setup_vault("senha").unwrap();
        let enc = svc.encrypt("dado").unwrap();

        let svc2 = CryptoService::new(dir.path()).unwrap();
        assert!(
            svc2.decrypt(&enc).is_err(),
            "decrypt() deve falhar com vault Locked"
        );
    }

    #[test]
    fn test_dado_cifrado_decifrado_apos_unlock() {
        // Dado cifrado em sessão anterior deve ser decifrado após unlock
        let dir = TempDir::new();
        let svc = CryptoService::new(dir.path()).unwrap();
        svc.setup_vault("minha_senha").unwrap();
        let enc = svc.encrypt("dado_persistido").unwrap();

        let svc2 = CryptoService::new(dir.path()).unwrap();
        svc2.unlock("minha_senha").unwrap();
        assert_eq!(
            svc2.decrypt(&enc).unwrap(),
            "dado_persistido",
            "dado cifrado na sessão anterior deve sobreviver ao unlock"
        );
    }

    // ── Import Vault ─────────────────────────────────────────────────────────

    #[test]
    fn test_import_vault_compartilha_dek_entre_dispositivos() {
        // Simula: Dispositivo A exporta vault; Dispositivo B importa e decifra dados do A
        let dir_a = TempDir::new();
        let svc_a = CryptoService::new(dir_a.path()).unwrap();
        svc_a.setup_vault("senha_compartilhada").unwrap();

        let payload_a = svc_a.get_vault_payload().unwrap();
        let enc_a = svc_a.encrypt("segredo_do_device_a").unwrap();

        let dir_b = TempDir::new();
        let svc_b = CryptoService::new(dir_b.path()).unwrap();
        svc_b
            .import_vault(&payload_a, "senha_compartilhada")
            .unwrap();

        assert!(svc_b.is_configured());
        assert!(!svc_b.is_locked());
        assert_eq!(
            svc_b.decrypt(&enc_a).unwrap(),
            "segredo_do_device_a",
            "Dispositivo B deve decifrar dados do Dispositivo A após import_vault"
        );
    }

    #[test]
    fn test_import_vault_falha_com_senha_errada() {
        let dir_a = TempDir::new();
        let svc_a = CryptoService::new(dir_a.path()).unwrap();
        svc_a.setup_vault("senha_real").unwrap();
        let payload_a = svc_a.get_vault_payload().unwrap();

        let dir_b = TempDir::new();
        let svc_b = CryptoService::new(dir_b.path()).unwrap();
        assert!(
            svc_b.import_vault(&payload_a, "senha_errada").is_err(),
            "import_vault com senha errada deve retornar erro"
        );
        assert!(
            !svc_b.is_configured(),
            "vault não deve ficar configurado após import_vault com senha errada"
        );
    }

    #[test]
    fn test_import_vault_falha_com_payload_malformado() {
        let dir = TempDir::new();
        let svc = CryptoService::new(dir.path()).unwrap();
        assert!(svc.import_vault("json inválido {{{", "qualquer").is_err());
    }

    #[test]
    fn test_import_vault_falha_com_payload_curto() {
        let dir = TempDir::new();
        let svc = CryptoService::new(dir.path()).unwrap();
        // JSON válido mas encrypted_dek curto demais
        let malformed = r#"{"salt":"AAAA","encrypted_dek":"AAAA"}"#;
        assert!(svc.import_vault(malformed, "qualquer").is_err());
    }
}
