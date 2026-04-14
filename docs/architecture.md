# Arquitetura do Sistema

> Última atualização: 2026-04-14

---

## Visão Geral (C4 — Nível 1: Contexto)

```mermaid
graph TB
    User["👤 Desenvolvedor\n(Usuário Final)"]
    App["SSH Orchestrator\n[Aplicação Tauri v2]"]
    GitHub["GitHub\n[Sistema Externo]"]
    RemoteServers["Servidores SSH/SFTP\n[Sistemas Externos]"]

    User -->|"Gerencia servidores,\nconecta via SSH/SFTP"| App
    App -->|"OAuth 2.0 + Git push/pull\n(HTTPS)"| GitHub
    App -->|"SSH (porta 22 ou custom)\nSFTP sobre SSH"| RemoteServers

    style App fill:#dcfce7,stroke:#15803d
    style GitHub fill:#f1f5f9,stroke:#475569
    style RemoteServers fill:#f1f5f9,stroke:#475569
    style User fill:#dbeafe,stroke:#1d4ed8
```

---

## Containers (C4 — Nível 2)

```mermaid
graph TB
    subgraph App["SSH Orchestrator (Tauri v2)"]
        FE["Frontend\nReact 19 + xterm.js\n[WebView do SO]"]
        Bridge["Tauri IPC Bridge\n[Ponte invoke/emit]"]
        BE["Backend\nRust + Tokio\n[Processo nativo]"]
        DB["SQLite\nssh_config.db\n[Banco criptografado]"]
        FS["Sistema de Arquivos\nvault.json, node_id.txt,\ngithub_token.enc\n[App Data Dir]"]
        SyncRepo["Repositório Git Local\nsync_repo/\n[Clone do repo GitHub]"]
    end

    GitHub["GitHub API\n[OAuth + Git Remote]"]
    SSH["Servidores SSH\n[russh]"]

    FE -->|"invoke() / listen()\n[IPC]"| Bridge
    Bridge <-->|"Commands + Events"| BE
    BE -->|"sqlx queries\n[SQLite]"| DB
    BE -->|"read/write\n[fs]"| FS
    BE -->|"git2 (clone/pull/push)\n[HTTPS]"| SyncRepo
    SyncRepo -->|"Git HTTPS"| GitHub
    BE -->|"SSH TCP\n(porta 22+)"| SSH

    style FE fill:#ede9fe,stroke:#6d28d9
    style BE fill:#dcfce7,stroke:#15803d
    style DB fill:#fef9c3,stroke:#a16207
    style Bridge fill:#f1f5f9,stroke:#475569
```

---

## Fluxo de Dados — Conexão SSH

```mermaid
sequenceDiagram
    participant FE as Frontend (React)
    participant IPC as Tauri IPC
    participant H as Handler ssh.rs
    participant DB as SQLite
    participant Crypto as CryptoService
    participant SSH as russh (TCP)
    participant Server as Servidor Remoto

    FE->>IPC: invoke("ssh_connect", {server_id, session_id})
    IPC->>H: ssh_connect(...)
    H->>DB: SELECT * FROM servers WHERE id = ?
    DB-->>H: ServerRow (com password_enc ou ssh_key_enc)
    H->>Crypto: decrypt(password_enc) ou decrypt(ssh_key_enc)
    Crypto-->>H: plaintext credential
    H->>SSH: connect(host, port, username, credential)
    SSH->>Server: TCP handshake + SSH handshake
    Server-->>SSH: Canal estabelecido + PTY alocado
    SSH-->>H: session_id confirmado
    H-->>IPC: Ok(session_id)
    IPC-->>FE: session_id
    loop Output contínuo
        Server->>SSH: dados do terminal
        SSH->>IPC: emit("ssh://data/{session_id}", bytes)
        IPC->>FE: evento xterm.js.write(data)
    end
```

---

## Fluxo de Dados — Sincronização (Push)

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant IPC as Tauri IPC
    participant S as sync/mod.rs
    participant GitOps as git_ops.rs
    participant Merge as merge.rs
    participant DB as SQLite
    participant FS as sync_repo/
    participant GH as GitHub

    FE->>IPC: invoke("push_workspace")
    IPC->>S: push_workspace(token)
    S->>GH: ensure_sync_repo_exists(token)
    GH-->>S: repo_info (clone_url)

    loop Até 3 tentativas (evitar force-push)
        S->>GitOps: pull(repo, token)
        GitOps->>GH: git fetch + merge
        S->>Merge: merge_workspaces + merge_servers (LWW HLC)
        Merge->>DB: UPSERT onde HLC remoto > HLC local
        S->>DB: SELECT workspaces + servers (pós-merge)
        DB-->>S: estado consolidado
        S->>FS: escreve {workspace_id}.json por workspace
        S->>FS: escreve vault_sync.json
        S->>GitOps: commit + push (fast-forward)
        GitOps->>GH: git push
        alt Push aceito (fast-forward)
            GH-->>S: 200 OK
            Note over S: Loop encerra
        else Push rejeitado (non-fast-forward)
            GH-->>S: Rejeitado
            Note over S: Repete loop (re-pull + re-merge)
        end
    end

    S-->>IPC: Ok()
    IPC-->>FE: evento "sync://progress" (done)
```

---

## Fluxo de Dados — Vault (Unlock)

```mermaid
sequenceDiagram
    participant FE as VaultGuard (React)
    participant IPC as Tauri IPC
    participant V as vault.rs (handler)
    participant C as CryptoService

    FE->>IPC: invoke("is_vault_configured")
    IPC->>C: is_configured()
    C-->>IPC: true
    IPC-->>FE: true

    FE->>IPC: invoke("is_vault_locked")
    IPC->>C: is_locked()
    C-->>IPC: true
    IPC-->>FE: true — exibe tela Unlock

    FE->>IPC: invoke("unlock_vault", {password})
    IPC->>V: unlock_vault(password)
    V->>C: unlock(password)
    Note over C: PBKDF2(password, salt, 100k iter) → KEK<br/>AES-256-GCM decrypt(encrypted_dek, KEK) → DEK<br/>Estado muda para Unlocked{dek}
    C-->>V: Ok()
    V-->>IPC: Ok()
    IPC-->>FE: sucesso → app renderiza
```

---

## Inventário de Serviços

| Serviço / Módulo | Responsabilidade | Tecnologia | Localização |
|---|---|---|---|
| Frontend | Interface do usuário, terminal xterm.js, SFTP UI | React 19 + Vite + TailwindCSS | `src/` |
| Tauri IPC Bridge | Ponte invoke/emit entre frontend e backend | Tauri v2 | runtime |
| DbService | Persistência de workspaces e servidores | SQLite + sqlx 0.7 | `services/db.rs` |
| CryptoService | Vault zero-knowledge, encrypt/decrypt AES-256-GCM | ring (Rust) | `services/crypto.rs` |
| SshService | Conexão SSH, PTY remoto, redimensionamento | russh 0.57 + DashMap | `services/ssh.rs` |
| SftpService | Operações de arquivo remoto e local, transferências | russh SFTP + DashMap | `services/sftp.rs` |
| PtyService | Shell local nativo, PTY multiplexado | portable-pty + DashMap | `services/pty.rs` |
| SyncModule | Orquestração push/pull, serialização, lock | Tokio Mutex + git2 | `sync/mod.rs` |
| CRDTEngine | HLC, LWW-Register, merge determinístico | Rust puro | `sync/crdt.rs` |
| GitOps | Clone, pull, commit, push (FF + force fallback) | git2 | `sync/git_ops.rs` |
| MergeModule | Merge LWW entre SQLite local e JSON remoto | sqlx + crdt | `sync/merge.rs` |
| RepoModule | Provisionamento do repo GitHub via API REST | reqwest | `sync/repo.rs` |
| AuthModule | GitHub OAuth 2.0, troca de código, perfil | reqwest + Tokio TCP | `auth/github.rs` |

---

## Decisões Arquiteturais (ADRs)

- [0001 — Tauri v2 como framework desktop](./adr/0001-tauri-v2-framework-desktop.md)
- [0002 — AES-256-GCM com PBKDF2 para vault zero-knowledge](./adr/0002-aes256gcm-pbkdf2-vault.md)
- [0003 — CRDT LWW-Register com HLC para resolução de conflitos](./adr/0003-crdt-lww-hlc-sync.md)
- [0004 — GitHub como backend de sincronização](./adr/0004-github-sync-backend.md)

---

## AppState — Estado Compartilhado do Backend

```rust
pub struct AppState {
    pub db: DbService,          // Pool SQLite (sqlx)
    pub ssh: SshService,        // DashMap<session_id, SshSession>
    pub sftp: SftpService,      // DashMap<session_id, SftpSession>
    pub pty: PtyService,        // DashMap<session_id, PtySession>
    pub crypto: CryptoService,  // RwLock<VaultState>
    pub sync_lock: Mutex<()>,   // Impede sincronizações concorrentes
    pub node_id: String,        // Identificador único do dispositivo (8 chars)
}
```

O `AppState` é injetado em todos os handlers via `tauri::State<'_, AppState>`, garantindo um único ponto de acesso a todos os serviços sem passagem explícita de dependências.
