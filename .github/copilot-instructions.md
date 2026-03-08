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
    ├── services/      → business logic (crypto, db, ssh, sftp)
    ├── sync/          → CRDT merge + git operations
    ├── auth/          → GitHub OAuth
    └── AppState       → shared state injected into handlers
```

**AppState** holds all long-lived services: the DB pool, the vault state, a `DashMap` of active SSH sessions, and the sync mutex.

## Backend Module Layout

```
src-tauri/src/
├── handlers/       IPC entry points (one file per domain)
│   └── workspace.rs, server.rs, ssh.rs, sftp.rs, vault.rs, auth.rs
├── services/       Business logic (no IPC types here)
│   └── crypto.rs, db.rs, ssh.rs, sftp.rs
├── models/         Shared data structures (Workspace, Server, HLC, etc.)
├── sync/           CRDT merge logic and Git push/pull
│   └── crdt.rs, merge.rs, git_ops.rs, repo.rs
├── auth/           GitHub OAuth (reqwest + GitHub API)
│   └── github.rs
├── lib.rs          App initialization, state wiring, command registration
└── main.rs         Entry point; sets up tracing subscriber
```

## Frontend Module Layout

```
src/
├── components/     React components (PascalCase filenames)
│   └── Terminal/, Sftp/, Workspaces/, Servers/, VaultGuard, Sidebar, ...
├── hooks/          Custom hooks (camelCase)
│   └── useTerminalManager.ts, useToast.tsx, useAuth.ts, useTerminalTheme.ts
├── lib/
│   ├── api/        Tauri invoke wrappers (one file per domain)
│   │   └── ssh.ts, servers.ts, sftp.ts, workspaces.ts
│   └── themes.ts, keybindings.ts
└── App.tsx, main.tsx
```

## Key IPC Commands

All commands return `Result<T, String>` — errors are stringified before crossing the IPC boundary.

| Command | Returns | Notes |
|---|---|---|
| `setup_vault(password)` | `()` | First-run vault initialization |
| `unlock_vault(password)` | `()` | Decrypts DEK into memory |
| `ssh_connect(server_id)` | `session_id: String` | Opens SSH session, returns UUID |
| `ssh_write(session_id, data)` | `()` | Sends keystrokes to session |
| `ssh_disconnect(session_id)` | `()` | Closes session |
| `push_workspace(id, token?)` | `()` | Pull-then-push to GitHub sync repo |
| `pull_workspace(id, token?)` | `()` | Fetch remote, CRDT merge into SQLite |
| `github_login()` | `User` | OAuth flow, stores encrypted token |

SSH output is delivered back to the frontend via **Tauri events** (`listen("ssh-output-{session_id}")`), not return values.

## Database Conventions

SQLite managed by `sqlx`. No migrations framework — schema changes use raw `ALTER TABLE ... ADD COLUMN` with `.ok()` to silently skip if the column already exists.

Every mutable table row has:
- `id TEXT` — UUID primary key
- `hlc TEXT` — Hybrid Logical Clock timestamp (for CRDT merging)
- `deleted BOOLEAN DEFAULT 0` — soft delete (hard deletes never used)

Passwords (`servers.password_enc`) are stored AES-256-GCM encrypted. They are never exposed to the frontend as plaintext.

## Encryption Architecture

Three-layer scheme using the `ring` crate:

```
Master Password  →(PBKDF2, 100k iterations)→  KEK
KEK              →(AES-256-GCM decrypt)→       DEK  (in memory only)
DEK              →(AES-256-GCM, per-field)→    Encrypted data
```

`VaultState` enum drives behavior:
- `Unconfigured { dek }` — first run, DEK is a random in-memory key
- `Locked` — vault.json exists on disk, DEK not available
- `Unlocked { dek }` — DEK in memory after successful `unlock_vault()`

The master password is **never stored**. The DEK is **never written to disk** in plaintext.

## CRDT Sync

Last-Writer-Wins Register with Hybrid Logical Clocks (HLC). HLC comparison order: `timestamp_ms` → `counter` → `node_id` (lexicographic tiebreak).

Sync targets a **private GitHub repository** (one JSON file per workspace under `sync_repo/workspaces/{id}.json`). Push always pulls first. A `tokio::sync::Mutex<()>` prevents concurrent sync operations.

Only workspaces with `sync_enabled = true` are synced. Raw passwords are never included in sync payloads.

## Error Handling Patterns

**Rust handlers**: use `anyhow::Result` internally, then `.map_err(|e| e.to_string())` at the IPC boundary.

**Rust services**: return `anyhow::Result<T>`; use `context("...")` for error wrapping.

**Frontend**: `try/catch` around `invoke()` calls, surfacing errors via `useToast().error(msg)`.

**Logging**: `tracing` crate throughout the backend. Handlers are annotated with `#[tracing::instrument]`.

## State Management (Frontend)

No Redux or Zustand. State is managed via:
- `useTerminalManager` hook — owns all terminal tab/split-pane state
- `useToast` + `ToastProvider` context — global notifications
- `useAuth` hook — GitHub login state
- `useTerminalTheme` hook — xterm.js theme, persisted to `localStorage`

## Tech Stack Summary

| Layer | Stack |
|---|---|
| Frontend | React 19, TypeScript (strict), TailwindCSS, xterm.js |
| Desktop bridge | Tauri v2 |
| Backend | Rust 1.77+, Tokio, SQLx (SQLite) |
| SSH/SFTP | russh 0.57, russh-sftp 2.1.1 |
| Crypto | ring 0.17 (AES-256-GCM, PBKDF2) |
| Git sync | git2 0.20 |
| HTTP | reqwest 0.13 (GitHub OAuth/API) |
| Package manager | pnpm (frontend), Cargo (backend) |

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

`scope` is optional and should identify area(s) affected (e.g., `ssh`, `sync`, `frontend`, `vault`, `sftp`, `crdt`, `lib`).

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
- `feat(workspace): add workspace sync toggle`
- `fix(ssh): handle reconnect when socket reset`
- `docs: update CONTRIBUTING with sync notes`
- `chore: bump git2 to 0.20`
- `feat!: switch sync format to new JSON schema` (the `!` indicates a breaking change in the commit header)

Enforcement and tooling (recommended):
- Use a commit linting tool (e.g., commitlint) with a Conventional Commits rule set and a Husky pre-commit or pre-push hook to validate messages.
- Optionally enable semantic-release or similar tooling if automated releases are desired.

Why this matters:
- Consistent messages make CHANGELOG generation, release automation, and code review easier.
- Clear message types help reviewers quickly understand intent and scope of changes.

Please apply these rules project-wide. If you need help setting up a local commit hook or commitlint config, we can add an example config and Husky setup in the repo.
