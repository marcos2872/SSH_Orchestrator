# AGENTS.md — SSH Orchestrator

Guidance for AI coding agents working in this repository.

---

## Project Overview

Tauri v2 desktop app: **React 19 + TypeScript** frontend communicating with a **Rust** backend exclusively via Tauri IPC (`invoke()`). The frontend never touches the filesystem, database, or network directly.

```
Frontend (React/xterm.js)
    │  invoke("command_name", { args })
    ▼
Tauri IPC Bridge
    ▼
Rust Handlers  (src-tauri/src/handlers/)
    ├── services/   → business logic (crypto, db, ssh, sftp, pty)
    ├── sync/       → CRDT merge + git operations
    ├── auth/       → GitHub OAuth
    └── AppState    → shared state injected into all handlers
```

---

## Build / Run / Test Commands

```bash
pnpm install                          # Install deps (pnpm only — never npm/yarn)
pnpm tauri dev                        # Full-stack dev (Rust + React, hot-reload)
pnpm dev                              # Frontend only (Vite, no Rust compilation)
pnpm build                            # Production build; also runs tsc type-check

cd src-tauri && cargo test            # Run ALL Rust tests
cd src-tauri && cargo test crdt       # Run all tests in the crdt module
cd src-tauri && cargo test test_hlc_ordering_timestamp          # Single test by name
cd src-tauri && cargo test test_lww_merge_newer_wins -- --nocapture  # With stdout
cd src-tauri && cargo fmt             # Format Rust code (run before committing)
cd src-tauri && cargo clippy          # Lint Rust code (address all warnings)
```

**No frontend test framework** (no Jest, Vitest, etc.). All tests are Rust `#[cfg(test)]` modules, located primarily in `src-tauri/src/sync/crdt.rs`.

---

## Directory Structure

```
src/                        # React / TypeScript frontend
├── components/             # PascalCase filenames
│   ├── Terminal/           # Remote SSH + local PTY terminals (xterm.js)
│   ├── Sftp/               # Dual-pane SFTP file manager
│   ├── Servers/            # Add/edit server modals
│   ├── Workspaces/         # Workspace detail view
│   └── sync/               # Sync progress indicator
├── hooks/                  # camelCase filenames (use* prefix)
└── lib/api/                # Thin invoke() wrappers, one file per domain

src-tauri/src/              # Rust backend
├── handlers/               # IPC entry points (#[tauri::command] fns)
├── services/               # Business logic: crypto, db, ssh, sftp, pty
├── models/                 # Shared structs: Workspace, Server, VaultConfig
├── sync/                   # CRDT/HLC merge, git push/pull
└── auth/                   # GitHub OAuth
```

---

## Code Style — TypeScript / Frontend

### Compiler settings (tsconfig.json)
- `"strict": true`, `"noUnusedLocals": true`, `"noUnusedParameters": true`, `"noFallthroughCasesInSwitch": true`
- **No ESLint or Prettier.** tsconfig strict mode is the sole linter.

### Imports
- All imports use **relative paths** (no path aliases).
- Use the `type` keyword for type-only imports: `import type { Server } from "../../lib/api/servers";`
- Tauri APIs: `import { invoke } from "@tauri-apps/api/core";` · `import { listen } from "@tauri-apps/api/event";`
- Icons: `import { Lock, Shield } from "lucide-react";`

### Typing
- Every component declares a local `interface Props {}`.
- State machines use union types: `type ConnectionState = "loading" | "connecting" | "connected" | "error"`
- `invoke` calls are always typed: `invoke<Server[]>("get_servers", { workspaceId })`
- Use `useRef<XTerm | null>(null)` and `useState<ConnectionState>("loading")` — never untyped.
- Use `?.` and `??` freely. Avoid `as` assertions except on DOM targets (`e.target as HTMLInputElement`).

### Naming conventions
| Category | Convention | Example |
|---|---|---|
| Component files | `PascalCase.tsx` | `ServerPickerModal.tsx` |
| Hook files | `camelCase.ts` | `useTerminalManager.ts` |
| API wrapper files | `camelCase.ts` | `ssh.ts`, `servers.ts` |
| Interfaces / types | `PascalCase` | `Server`, `ConnectionState` |
| Hooks | `use` prefix | `useToast`, `useAuth` |
| Constants | `UPPER_SNAKE_CASE` | `KEYBINDINGS`, `DEFAULT_THEME_ID` |
| Functions / variables | `camelCase` | `handleConnect`, `openTab` |

### Styling & state
- **TailwindCSS only.** No CSS Modules or styled-components. Hand-written CSS only for dynamic values.
- Custom tokens in `tailwind.config.js`: `background`, `foreground`, `primary`, `secondary`.
- **No Redux or Zustand.** Global state lives in custom hooks: `useTerminalManager`, `useToast` + `ToastProvider`, `useAuth`, `useTerminalTheme`.

### Frontend error handling
- Wrap every `invoke()` in `try/catch`. Surface errors via `useToast().error(msg)`.
- Use inline error state (not toast) for form validation.
- Fire-and-forget: `sshWrite(sid, data).catch(() => {})`.
- UI strings (including errors) are in **Brazilian Portuguese**.

---

## Code Style — Rust / Backend

### Imports & formatting
- Edition **2021**. No `rustfmt.toml` or `clippy.toml` — standard defaults.
- Import groups in order: `std` → external crates → `crate::`.
- No glob imports except `use super::*;` inside `#[cfg(test)]` blocks.
- Crate-local prefix: `use crate::AppState;`, `use crate::services::crypto::CryptoService;`

### Naming conventions
| Category | Convention | Example |
|---|---|---|
| Structs / Enums | `PascalCase` | `AppState`, `HLC`, `SessionMsg` |
| Functions / methods | `snake_case` | `get_or_create_node_id`, `merge_workspaces` |
| Tauri IPC commands | `snake_case` | `ssh_connect`, `pty_spawn` |
| Tauri event channels | URI-style | `pty://data/{id}`, `pty://close/{id}` |
| DB columns | `snake_case` | `workspace_id`, `password_enc` |

### Types
- Derive `Debug`, `Clone`, `Serialize`, `Deserialize` on structs; add `sqlx::FromRow` for DB row types.
- `Option<T>` for nullable fields. Shared mutable state: `Arc<Mutex<T>>` (sync) or `Arc<tokio::sync::Mutex<T>>` (async).
- High-concurrency session maps: `DashMap<K, V>`.
- **All IPC commands return `Result<T, String>`.** Never return `anyhow::Error` across the IPC boundary.

### Error handling
- **Services**: return `anyhow::Result<T>`; use `?` to propagate and `.context("...")` to annotate.
- **Handlers**: `.map_err(|e| e.to_string())` at the IPC boundary.
- DB migrations swallow "column already exists": `.execute(&pool).await.ok();`
- Log with `tracing`: `tracing::info!`, `tracing::warn!`, `tracing::error!`, `tracing::debug!`
- Annotate handlers with `#[tracing::instrument]`.

### Database conventions
- Raw `sqlx` queries (no ORM). Every mutable row requires: `id TEXT` (UUID v4), `hlc TEXT` (HLC timestamp), `deleted BOOLEAN DEFAULT 0`.
- **Hard deletes are forbidden.** Always soft-delete (`deleted = 1`; never `DELETE FROM`).
- Passwords (`password_enc`) are AES-256-GCM encrypted and never sent to the frontend as plaintext — the frontend receives `has_saved_password: bool`.

---

## Key Architectural Rules

1. **Frontend never accesses filesystem, DB, or network.** All I/O goes through `invoke()`.
2. **Streaming data uses Tauri events, not return values.** SSH output → `listen("ssh-output-{id}")`. PTY output → `listen("pty://data/{id}")`.
3. **Passwords never cross the IPC boundary as plaintext.**
4. **`pnpm` only.** Do not use `npm` or `yarn`.

---

## Commit Message Format

[Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <short description>`

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `build`, `ci`, `revert`  
Scopes: `ssh`, `sync`, `vault`, `sftp`, `pty`, `crdt`, `frontend`, `lib`

```
feat(workspace): Add workspace sync toggle
fix(ssh): Handle reconnect when socket reset
chore: Bump git2 to 0.20
feat!: Switch sync format to new JSON schema   # ! = breaking change
```

Imperative mood, max ~72 chars, no trailing period. Breaking changes: `BREAKING CHANGE: <desc>` in footer.
