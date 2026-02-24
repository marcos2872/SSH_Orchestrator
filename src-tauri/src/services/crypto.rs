use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};
use ring::rand::{SecureRandom, SystemRandom};
use std::fs;
use std::path::PathBuf;

const KEY_LEN: usize = 32; // AES-256

/// Device-scoped encryption service using AES-256-GCM.
///
/// # Key management
/// Generates a random 32-byte key on first launch and stores it at
/// `app_data_dir/app.key`. This key is device-specific and NOT derived from
/// the user's password — it protects against casual file-system exposure.
///
/// **Phase 0.2** will replace this with a key derived from the Master Password
/// (PBKDF2) so that the vault becomes truly zero-knowledge.
pub struct CryptoService {
    key_bytes: [u8; KEY_LEN],
    rng: SystemRandom,
}

impl CryptoService {
    pub fn new(app_data_dir: &PathBuf) -> Result<Self> {
        let key_path = app_data_dir.join("app.key");

        let key_bytes: [u8; KEY_LEN] = if key_path.exists() {
            let raw = fs::read(&key_path)?;
            raw.try_into()
                .map_err(|_| anyhow!("Chave app.key corrompida (tamanho inválido)"))?
        } else {
            let rng = SystemRandom::new();
            let mut key = [0u8; KEY_LEN];
            rng.fill(&mut key)
                .map_err(|_| anyhow!("Falha ao gerar chave aleatória"))?;
            fs::write(&key_path, &key)?;
            key
        };

        Ok(Self {
            key_bytes,
            rng: SystemRandom::new(),
        })
    }

    /// Encrypt `plaintext` → `base64(nonce ‖ ciphertext+tag)`.
    pub fn encrypt(&self, plaintext: &str) -> Result<String> {
        let mut nonce_bytes = [0u8; NONCE_LEN];
        self.rng
            .fill(&mut nonce_bytes)
            .map_err(|_| anyhow!("Falha ao gerar nonce"))?;

        let key = LessSafeKey::new(
            UnboundKey::new(&AES_256_GCM, &self.key_bytes)
                .map_err(|_| anyhow!("Falha ao criar chave AES"))?,
        );

        let nonce = Nonce::assume_unique_for_key(nonce_bytes);
        let mut buf = plaintext.as_bytes().to_vec();

        key.seal_in_place_append_tag(nonce, Aad::empty(), &mut buf)
            .map_err(|_| anyhow!("Falha ao encriptar"))?;

        // Prepend the nonce so we can recover it during decryption
        let mut output = nonce_bytes.to_vec();
        output.extend_from_slice(&buf);
        Ok(B64.encode(&output))
    }

    /// Decrypt `base64(nonce ‖ ciphertext+tag)` → plaintext.
    pub fn decrypt(&self, encoded: &str) -> Result<String> {
        let raw = B64
            .decode(encoded)
            .map_err(|_| anyhow!("Base64 inválido ao decriptar"))?;

        if raw.len() < NONCE_LEN + 16 {
            return Err(anyhow!("Payload encriptado muito curto"));
        }

        let (nonce_slice, ciphertext) = raw.split_at(NONCE_LEN);
        let nonce = Nonce::assume_unique_for_key(nonce_slice.try_into().unwrap());

        let key = LessSafeKey::new(
            UnboundKey::new(&AES_256_GCM, &self.key_bytes)
                .map_err(|_| anyhow!("Falha ao criar chave AES"))?,
        );

        let mut buf = ciphertext.to_vec();
        let plaintext = key
            .open_in_place(nonce, Aad::empty(), &mut buf)
            .map_err(|_| anyhow!("Falha ao decriptar: dados ou chave inválidos"))?;

        String::from_utf8(plaintext.to_vec())
            .map_err(|_| anyhow!("Texto decriptado não é UTF-8 válido"))
    }
}
