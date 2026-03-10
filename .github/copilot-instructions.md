# Copilot Instructions for SSH Orchestrator

## Commands

```bash
# Full-stack dev (Rust backend + React frontend)
pnpm tauri dev

# Frontend only (no Rust compilation)
pnpm dev

# Production build
pnpm build

# Rust: all tests
cd src-tauri && cargo test

# Rust: single test (e.g., the CRDT merge tests)
cd src-tauri && cargo test crdt

# Rust: test a specific function
cd src-tauri && cargo test test_hlc_ordering

# Type-check frontend
pnpm build   # tsc runs as part of Vite build
```

There is no frontend test framework configured. Rust inline tests (`#[cfg(test)]`) exist in `src-tauri/src/sync/crdt.rs`.

## Architecture

This is a Tauri v2 desktop app: a React 19 + TypeScript frontend communicating with a Rust backend exclusively via **Tauri IPC commands** (`invoke()`). The frontend never accesses the filesystem, database, or network directly.

```
Frontend (React/xterm.js)
    │  invoke("command_name", { args })
    ▼
Tauri IPC Bridge
    │
    ▼
Rust Handlers  (src-tauri/src/handlers/)
    ├── services/      → business logic (crypto, db, ssh, sftp, pty)
    ├── sync/          → CRDT merge + git operations
    ├── auth/          → GitHub OAuth
    └── AppState       → shared state injected into handlers
```

**AppState** holds all long-lived services: the DB pool, the vault/crypto state, SSH sessions, SFTP sessions, the local PTY service, the sync mutex, and the device `node_id`.

## Backend Module Layout

```
src-tauri/src/
├── handlers/       IPC entry points (one file per domain)
│   ├── mod.rs      Re-exports + greet command
│   ├── workspace.rs
│   ├── server.rs
│   ├── ssh.rs
│   ├── sftp.rs
│   ├── pty.rs      Local shell (PTY) spawn/write/resize/kill
│   ├── vault.rs
│   └── auth.rs
├── services/       Business logic (no IPC types here)
│   ├── mod.rs
│   ├── crypto.rs   AES-256-GCM vault + per-field encryption
│   ├── db.rs       SQLite via sqlx
│   ├── ssh.rs      Remote SSH sessions (russh)
│   ├── sftp.rs     Remote + local filesystem operations (russh-sftp)
│   └── pty.rs      Local PTY sessions (portable-pty)
├── models/         Shared data structures
│   ├── mod.rs      Workspace, Server, ServerRow
│   └── vault.rs    VaultConfig
├── sync/           CRDT merge logic and Git push/pull
│   ├── mod.rs      pull_workspace, push_workspace IPC commands
│   ├── crdt.rs     HLC utilities, node_id generation
│   ├── merge.rs    LWW merge for workspaces & servers
│   ├── git_ops.rs  Git clone/pull/push via git2
│   └── repo.rs     GitHub sync repo provisioning
├── auth/           GitHub OAuth (reqwest + GitHub API)
│   ├── mod.rs
│   └── github.rs
├── lib.rs          App initialization, state wiring, command registration
└── main.rs         Entry point; sets up tracing subscriber
```

## Frontend Module Layout

```
src/
├── components/         React components (PascalCase filenames)
│   ├── Terminal/
│   │   ├── Terminal.tsx            Remote SSH terminal (xterm.js)
│   │   ├── LocalTerminal.tsx       Local shell terminal (xterm.js + PTY)
│   │   ├── TerminalTabBar.tsx      Tab bar for terminal sessions
│   │   ├── TerminalWorkspace.tsx   Split-pane terminal layout
│   │   └── ServerPickerModal.tsx   Server selection dialog
│   ├── Sftp/
│   │   ├── SftpDualPane.tsx        Dual-pane file manager
│   │   └── SftpPanel.tsx           Single SFTP panel (local or remote)
│   ├── Workspaces/
│   │   └── WorkspaceDetail.tsx
│   ├── Servers/
│   │   └── AddServerModal.tsx
│   ├── sync/
│   │   └── SyncStatus.tsx          Sync progress indicator
│   ├── Modal.tsx
│   ├── Sidebar.tsx
│   ├── TitleBar.tsx
│   ├── Toast.tsx
│   └── VaultGuard.tsx              Gate component: unlock/setup vault before app
├── hooks/              Custom hooks (camelCase)
│   ├── useTerminalManager.ts       Terminal tab/split-pane state
│   ├── useToast.tsx                Global toast notifications
│   ├── useAuth.ts                  GitHub login state
│   └── useTerminalTheme.ts         xterm.js theme (persisted to localStorage)
├── lib/
│   ├── api/            Tauri invoke wrappers (one file per domain)
│   │   ├── ssh.ts
│   │   ├── servers.ts
│   │   ├── sftp.ts
│   │   ├── workspaces.ts
│   │   └── pty.ts      Local PTY spawn/write/resize/kill wrappers
│   ├── themes.ts
│   └── keybindings.ts
├── App.tsx
├── App.css
├── index.css
├── main.tsx
└── vite-env.d.ts
```

## Key IPC Commands

All commands return `Result<T, String>` — errors are stringified before crossing the IPC boundary.

### Vault

| Command | Returns | Notes |
|---|---|---|
| `is_vault_configured()` | `bool` | Check if vault.json exists on disk |
| `is_vault_locked()` | `bool` | Check if DEK is currently in memory |
| `setup_vault(password)` | `()` | First-run vault initialization; records last access |
| `unlock_vault(password)` | `()` | Decrypts DEK into memory; records last access |
| `get_vault_last_access()` | `Option<String>` | ISO 8601 timestamp of last unlock (from vault_meta.json) |
| `check_synced_vault()` | `bool` | True if `sync_repo/vault_sync.json` exists |
| `import_synced_vault(password)` | `()` | Import vault from synced device; re-encrypts GitHub token |

### SSH (Remote)

| Command | Returns | Notes |
|---|---|---|
| `ssh_connect(server_id, password?, session_id, cols?, rows?)` | `session_id: String` | Opens SSH session; auto-decrypts saved password if none provided |
| `ssh_write(session_id, data)` | `()` | Sends keystrokes to remote session |
| `ssh_resize(session_id, cols, rows)` | `()` | Resize remote PTY |
| `ssh_disconnect(session_id)` | `()` | Closes remote session |

SSH output is delivered to the frontend via **Tauri events** (`listen("ssh-output-{session_id}")`), not return values.

### PTY (Local Shell)

| Command | Returns | Notes |
|---|---|---|
| `pty_spawn(session_id, cols?, rows?, shell?)` | `session_id: String` | Spawns a local shell (detects default); output via `pty://data/{session_id}` events |
| `pty_write(session_id, data)` | `()` | Sends base64-encoded keystrokes to local shell stdin |
| `pty_resize(session_id, cols, rows)` | `()` | Resize local PTY |
| `pty_kill(session_id)` | `()` | Kill local shell and cleanup session |

Local PTY output is base64-encoded and delivered via `pty://data/{session_id}` events. Shell exit emits `pty://close/{session_id}`.

### SFTP

| Command | Returns | Notes |
|---|---|---|
| `sftp_open_session(server_id)` | `session_id` | Opens SFTP over existing SSH session |
| `sftp_direct_connect(host, port, username, password)` | `session_id` | Opens SSH+SFTP without a shell (dual-pane file manager) |
| `sftp_list_dir(session_id, path)` | `Vec<SftpEntry>` | List remote directory |
| `sftp_list_local(path)` | `Vec<LocalEntry>` | List local filesystem directory |
| `sftp_workdir(session_id)` | `String` | Remote home dir (realpath ".") |
| `sftp_home_dir()` | `String` | Local $HOME path |
| `sftp_upload(session_id, local_path, remote_path)` | `()` | Upload file to remote |
| `sftp_download(session_id, remote_path, local_path)` | `()` | Download file from remote |
| `sftp_delete(session_id, path)` | `()` | Delete remote file/dir |
| `sftp_delete_local(path)` | `()` | Delete local file/dir |
| `sftp_rename(session_id, from, to)` | `()` | Rename remote file/dir |
| `sftp_rename_local(from, to)` | `()` | Rename local file/dir |
| `sftp_mkdir(session_id, path)` | `()` | Create remote directory |
| `sftp_mkdir_local(path)` | `()` | Create local directory |
| `sftp_close_session(session_id)` | `()` | Close SFTP session |

### Sync & Auth

| Command | Returns | Notes |
|---|---|---|
| `push_workspace(provided_token?)` | `()` | Pull-merge-push to GitHub sync repo |
| `pull_workspace(provided_token?)` | `()` | Fetch remote, CRDT merge into SQLite |
| `github_login()` | `AuthResponse { user }` | OAuth flow; stores encrypted token; provisions sync repo; triggers initial pull |
| `get_current_user()` | `Option<AuthResponse>` | Restores session from encrypted token on disk; triggers background pull |
| `github_logout()` | `()` | Clears in-memory token and deletes encrypted token file |

Sync progress is reported via `sync://progress` events with `{ step, detail }` payloads.

### Workspace & Server CRUD

| Command | Returns | Notes |
|---|---|---|
| `get_workspaces()` | `Vec<Workspace>` | Lists non-deleted workspaces |
| `create_workspace(...)` | `Workspace` | |
| `update_workspace(...)` | `()` | |
| `delete_workspace(id)` | `()` | Soft delete |
| `get_servers(workspace_id)` | `Vec<Server>` | Lists non-deleted servers in workspace |
| `create_server(...)` | `Server` | |
| `update_server(...)` | `()` | |
| `delete_server(id)` | `()` | Soft delete |
| `get_server_password(id)` | `String` | Decrypts and returns the saved password |

## Database Conventions

SQLite managed by `sqlx`. No migrations framework — schema changes use raw `ALTER TABLE ... ADD COLUMN` with `.ok()` to silently skip if the column already exists.

Every mutable table row has:
- `id TEXT` — UUID primary key
- `hlc TEXT` — Hybrid Logical Clock timestamp (for CRDT merging)
- `deleted BOOLEAN DEFAULT 0` — soft delete (hard deletes never used)

Passwords (`servers.password_enc`) are stored AES-256-GCM encrypted. They are never exposed to the frontend as plaintext. The `Server` model sent to the frontend contains `has_saved_password: bool` instead of the actual encrypted value.

Server tags are stored as a JSON string in SQLite and deserialized into `Vec<String>` via `ServerRow::into_server()`.

## Encryption Architecture

Three-layer scheme using the `ring` crate:

```
Master Password  →(PBKDF2, 100k iterations)→  KEK
KEK              →(AES-256-GCM decrypt)→       DEK  (in memory only)
DEK              →(AES-256-GCM, per-field)→    Encrypted data
```

`VaultConfig` on disk (`vault.json`) stores `{ salt, encrypted_dek }`.

`CryptoService` manages vault lifecycle:
- `is_configured()` / `is_locked()` — state queries
- `setup_vault(password)` — first-run: generates DEK, derives KEK, persists encrypted DEK
- `unlock(password)` — derives KEK, decrypts DEK into memory
- `encrypt(plaintext)` / `decrypt(ciphertext)` — per-field AES-256-GCM using in-memory DEK
- `get_vault_payload()` — exports vault config for sync
- `import_vault(payload, password)` — imports vault from another device

The master password is **never stored**. The DEK is **never written to disk** in plaintext.

Vault metadata (`vault_meta.json`) tracks the last unlock timestamp for UI display.

The GitHub OAuth token is encrypted with the DEK and stored as `github_token.enc`. On vault import from a synced device, the token is re-encrypted with the new DEK.

## Local PTY Architecture

The `PtyService` uses `portable-pty` to spawn local shell processes. It is entirely synchronous (std threads, std mpsc channels) — no Tokio dependency.

Each session consists of:
- A **writer thread** that receives `PtyMsg::Data` (stdin bytes) and `PtyMsg::Resize` messages via `std::sync::mpsc`
- A **reader thread** that reads PTY output and emits base64-encoded Tauri events (`pty://data/{id}`)
- On shell exit, a `pty://close/{id}` event is emitted

Default shell detection: `$SHELL` on Unix (fallback `/bin/bash`), `%COMSPEC%` on Windows (fallback `powershell.exe`). On Unix, shells are started as login shells (`-l` flag) with `TERM=xterm-256color`.

Killing a session drops the mpsc sender → writer thread exits → master PTY drops → reader thread gets EOF and exits.

## CRDT Sync

Last-Writer-Wins Register with Hybrid Logical Clocks (HLC). HLC comparison order: `timestamp_ms` → `counter` → `node_id` (lexicographic tiebreak).

The `node_id` is a stable per-device identifier generated once and persisted in the app data directory.

Sync targets a **private GitHub repository** (one JSON file per workspace under `sync_repo/workspaces/{id}.json`). The sync flow:

1. **Pull**: `git fetch` + fast-forward merge → parse remote JSONs → LWW merge into SQLite
2. **Push**: pull first (step 1) → serialize post-merge local DB to JSON → `git add` + `commit` + `push`

A `tokio::sync::Mutex<()>` prevents concurrent sync operations (uses `try_lock`, returns error if already syncing).

Only workspaces with `sync_enabled = true` are synced. Raw passwords are never included in sync payloads (`password_enc` is annotated with `#[serde(skip_serializing)]`).

Vault config is also synced (`sync_repo/vault_sync.json`) so other devices can import the vault with the same master password.

Commit messages include the node_id, timestamp, synced workspace names, and server count for human-readable git history.

## Error Handling Patterns

**Rust handlers**: use `anyhow::Result` internally, then `.map_err(|e| e.to_string())` at the IPC boundary.

**Rust services**: return `anyhow::Result<T>`; use `context("...")` for error wrapping.

**Frontend**: `try/catch` around `invoke()` calls, surfacing errors via `useToast().error(msg)`.

**Logging**: `tracing` crate throughout the backend. Handlers are annotated with `#[tracing::instrument]`.

## State Management (Frontend)

No Redux or Zustand. State is managed via:
- `useTerminalManager` hook — owns all terminal tab/split-pane state (both local and remote)
- `useToast` + `ToastProvider` context — global notifications
- `useAuth` hook — GitHub login state
- `useTerminalTheme` hook — xterm.js theme, persisted to `localStorage`

## Tech Stack Summary

| Layer | Stack |
|---|---|
| Frontend | React 19, TypeScript (strict), TailwindCSS, xterm.js 5.3, react-resizable-panels |
| Icons | lucide-react |
| Desktop bridge | Tauri v2 (with tauri-plugin-opener) |
| Backend | Rust (edition 2021), Tokio, SQLx 0.7 (SQLite) |
| SSH/SFTP | russh 0.57, russh-sftp 2.1.1 |
| Local PTY | portable-pty 0.8 |
| Crypto | ring 0.17 (AES-256-GCM, PBKDF2) |
| Git sync | git2 0.20 |
| HTTP | reqwest 0.13 (GitHub OAuth/API, rustls) |
| Serialization | serde 1, serde_json 1 |
| IDs & Time | uuid 1.7 (v4), chrono 0.4 |
| Concurrency | dashmap 6, tokio::sync::Mutex |
| Error handling | anyhow 1, thiserror 2 |
| Logging | tracing 0.1, tracing-subscriber 0.3 |
| Misc | base64 0.22, rand 0.8, url 2.5, open 5.3, lazy_static 1.5, dotenvy 0.15 |
| Build | pnpm (frontend), Cargo (backend), Vite 7 |

## Conventional Commits (Guidelines)

To keep the repository history consistent and machine-readable, follow the Conventional Commits specification for commit messages:

Commit message format:
- `<type>(<scope>): <short description>`
- Optional blank line
- Optional body with more details
- Optional footer(s) (e.g., "Closes #123", BREAKING CHANGE, metadata)

Common `type` values:
- `feat`: a new feature
- `fix`: a bug fix
- `docs`: documentation only changes
- `style`: formatting, missing semicolons, etc (no code changes)
- `refactor`: code change that neither fixes a bug nor adds a feature
- `perf`: a code change that improves performance
- `test`: adding or updating tests
- `chore`: build process or auxiliary tooling changes
- `build`: changes that affect the build system or external dependencies
- `ci`: CI configuration and scripts
- `revert`: reverts a previous commit

`scope` is optional and should identify area(s) affected (e.g., `ssh`, `sync`, `frontend`, `vault`, `sftp`, `pty`, `crdt`, `lib`).

Short description rules:
- Keep it imperative and concise (max ~72 characters).
- Capitalize the first word, do not end with a period.

Body:
- Explain the motivation and contrast with the previous behavior.
- Include implementation notes only if they help future readers.

Breaking changes:
- Indicate breaking changes with `BREAKING CHANGE: <description>` in the footer or body.
- Include migration notes and any steps required for consumers.

Examples:
- `feat(workspace): Add workspace sync toggle`
- `fix(ssh): Handle reconnect when socket reset`
- `feat(pty): Add local shell terminal support`
- `docs: Update CONTRIBUTING with sync notes`
- `chore: Bump git2 to 0.20`
- `feat!: Switch sync format to new JSON schema` (the `!` indicates a breaking change in the commit header)

Enforcement and tooling (recommended):
- Use a commit linting tool (e.g., commitlint) with a Conventional Commits rule set and a Husky pre-commit or pre-push hook to validate messages.
- Optionally enable semantic-release or similar tooling if automated releases are desired.

Why this matters:
- Consistent messages make CHANGELOG generation, release automation, and code review easier.
- Clear message types help reviewers quickly understand intent and scope of changes.

Please apply these rules project-wide. If you need help setting up a local commit hook or commitlint config, we can add an example config and Husky setup in the repo.