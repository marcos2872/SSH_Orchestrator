# 0002 — AES-256-GCM com PBKDF2 para Vault Zero-Knowledge

## Status

aceito

## Contexto

Credenciais SSH (senhas, chaves privadas PEM, passphrases) precisam ser armazenadas localmente e sincronizadas entre dispositivos via repositório GitHub **sem expor** os valores em texto claro — nem no banco local, nem no repositório remoto.

Requisitos:
- Confidencialidade: ciphertext não revela o plaintext sem a master password
- Integridade: adulteração detectável
- Portabilidade: cofre pode ser transferido entre dispositivos
- Sem dependência de serviço de terceiros (HSM, KMS, etc.)

Alternativas consideradas:
- **Bcrypt/scrypt para senhas**: apenas KDF, não serve para criptografia de dados
- **Keychain do SO (Keytar)**: não portável entre dispositivos; perde dados na reinstalação
- **Age (age-encryption.org)**: boa opção, mas menos integrada com `ring` e o ecossistema Rust já adotado
- **nacl/libsodium**: excelente, mas o projeto já usava `ring` para outros fins

## Decisão

Arquitetura de duas chaves com `ring`:

1. **PBKDF2-HMAC-SHA256** (100.000 iterações, salt 16 bytes aleatórios) deriva a **KEK** da master password
2. **AES-256-GCM** com nonce aleatório por operação cifra a **DEK** com a KEK → resultado armazenado em `vault.json`
3. A **DEK** cifra cada credencial individualmente com **AES-256-GCM** → armazenado como base64 no SQLite

A master password nunca é armazenada. O `vault.json` pode ser sincronizado com segurança pois sem a master password a DEK não pode ser extraída.

## Consequências

- (+) AES-256-GCM fornece confidencialidade + autenticidade (authentication tag detecta adulteração)
- (+) PBKDF2 com 100k iterações adiciona latência artificial (~300ms) que dificulta ataques de força bruta
- (+) DEK separada da KEK permite troca de master password sem re-cifrar todos os dados
- (+) Portabilidade: `vault.json` pode ser importado em novo dispositivo com a mesma master password
- (+) Zero dependência de serviços externos — funciona offline
- (-) Perda da master password = perda irreversível de acesso aos dados (advertido na UI)
- (-) 100.000 iterações PBKDF2 pode ser lento em hardware muito antigo (<1 CPU core antigo)
- (-) PBKDF2 é menos resistente a GPU cracking que Argon2id (trade-off: Argon2 não está em `ring`)

Ver também: [0004 — GitHub como backend de sincronização](0004-github-sync-backend.md)
