# AGENTS.md — SSH Orchestrator

Guidance for AI coding agents working in this repository. This file synthesizes information from `.github/copilot-instructions.md`, which remains the canonical reference for IPC command tables, architecture diagrams, and full module layouts.

---

## Project Overview

Tauri v2 desktop app: a **React 19 + TypeScript** frontend communicating with a **Rust** backend exclusively via Tauri IPC (`invoke()`). The frontend never touches the filesystem, database, or network directly.

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
# Install dependencies (use pnpm, not npm/yarn)
pnpm install

# Full-stack dev (Rust backend + React frontend, hot-reload)
pnpm tauri dev

# Frontend only (Vite dev server, no Rust compilation)
pnpm dev

# Production build (runs tsc then vite build)
pnpm build

# Preview production build
pnpm preview

# Run ALL Rust tests
cd src-tauri && cargo test

# Run a SINGLE test by name (filter substring)
cd src-tauri && cargo test test_hlc_ordering_timestamp

# Run a single test with stdout visible
cd src-tauri && cargo test test_lww_merge_newer_wins -- --nocapture

# Run all tests in the crdt module
cd src-tauri && cargo test crdt

# Type-check frontend (tsc runs as part of the Vite build)
pnpm build
```

**No frontend test framework is configured** (no Jest, Vitest, etc.). All tests are Rust inline `#[cfg(test)]` tests located in `src-tauri/src/sync/crdt.rs`.

---

## Directory Structure (Summary)

```
src/                        # React / TypeScript frontend
├── components/             # PascalCase filenames (e.g. Terminal.tsx)
│   ├── Terminal/           # Remote SSH + local PTY terminals
│   ├── Sftp/               # Dual-pane SFTP file manager
│   ├── Servers/            # Add/edit server modals
│   ├── Workspaces/         # Workspace detail view
│   └── sync/               # Sync progress indicator
├── hooks/                  # camelCase filenames (use* prefix)
├── lib/
│   └── api/                # Thin invoke() wrappers, one file per domain

src-tauri/src/              # Rust backend
├── handlers/               # IPC entry points (#[tauri::command] fns)
├── services/               # Business logic (no IPC types)
├── models/                 # Shared structs (Workspace, Server, VaultConfig)
├── sync/                   # CRDT merge, HLC, git operations
└── auth/                   # GitHub OAuth
```

---

## Code Style — TypeScript / Frontend

### Compiler Enforcement (tsconfig.json)
- `"strict": true` — all strict checks enabled
- `"noUnusedLocals": true` and `"noUnusedParameters": true`
- `"noFallthroughCasesInSwitch": true`
- Target: ES2020, module: ESNext, jsx: react-jsx

**No ESLint or Prettier config files exist.** tsconfig strict mode is the linter.

### Imports
- All imports are **relative paths** (no path aliases configured).
- Use the `type` keyword for type-only imports:
  ```typescript
  import type { Server } from "../../lib/api/servers";
  ```
- Named imports for utilities, hooks, and types; default imports for React components.
- Tauri APIs:
  ```typescript
  import { invoke } from "@tauri-apps/api/core";
  import { listen, UnlistenFn } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  ```
- Icons: `import { Lock, Shield } from "lucide-react"`

### Typing
- Every component has a local `interface Props {}` declaration.
- Union types for state machines: `type ConnectionState = "loading" | "connecting" | "connected" | "error"`
- `invoke` calls are always typed: `invoke<Server[]>("get_servers", { workspaceId })`
- Prefer `useRef<XTerm | null>(null)` and `useState<ConnectionState>("loading")` over untyped variants.
- Use optional chaining (`?.`) and nullish coalescing (`??`) freely.
- Avoid `as` type assertions except for DOM targets (`e.target as HTMLInputElement`).

### Naming Conventions
| Category | Convention | Example |
|---|---|---|
| Component files | `PascalCase.tsx` | `ServerPickerModal.tsx` |
| Hook files | `camelCase.ts/tsx` | `useTerminalManager.ts` |
| API wrapper files | `camelCase.ts` | `ssh.ts`, `servers.ts` |
| Interfaces / types | `PascalCase` | `Server`, `ConnectionState` |
| React components | `PascalCase` | `VaultGuard`, `Terminal` |
| Hooks | `camelCase` with `use` prefix | `useToast`, `useAuth` |
| Constants | `UPPER_SNAKE_CASE` | `KEYBINDINGS`, `DEFAULT_THEME_ID` |
| Functions / variables | `camelCase` | `handleConnect`, `openTab` |

### Styling
- **TailwindCSS only** for all styling. No CSS Modules or styled-components.
- Hand-written CSS is allowed only for values that cannot be expressed statically (e.g., dynamic colors from data).
- Custom theme tokens are defined in `tailwind.config.js`: `background`, `foreground`, `primary`, `secondary`.

### State Management
- No Redux or Zustand. Use local `useState`/`useReducer` and custom hooks.
- Global state lives in: `useTerminalManager` (tab/split state), `useToast` + `ToastProvider` (notifications), `useAuth` (GitHub session), `useTerminalTheme` (xterm theme via localStorage).

---

## Code Style — Rust / Backend

### Formatting & Linting
- Rust edition **2021**. No `rustfmt.toml` or `clippy.toml` — use standard `rustfmt` and `clippy` defaults.
- Run `cargo fmt` before committing. Run `cargo clippy` and address warnings.

### Imports
- Crate-local imports use `crate::` prefix: `use crate::AppState;`, `use crate::services::crypto::CryptoService;`
- No glob imports (`use x::*`) except inside `#[cfg(test)]` modules (`use super::*;`).
- Common import groups (in order): std → external crates → crate-local.

### Naming Conventions
| Category | Convention | Example |
|---|---|---|
| Structs / Enums | `PascalCase` | `AppState`, `HLC`, `SessionMsg` |
| Functions / methods | `snake_case` | `get_or_create_node_id`, `merge_workspaces` |
| Modules / files | `snake_case` | `git_ops`, `crypto`, `handlers` |
| Tauri IPC commands | `snake_case` (Rust) | `ssh_connect`, `pty_spawn` |
| Tauri event channels | URI-style | `ssh://data/{id}`, `pty://close/{id}` |
| DB columns | `snake_case` | `workspace_id`, `password_enc` |

### Types
- Derive `Debug`, `Clone`, `Serialize`, `Deserialize` on structs as appropriate; add `sqlx::FromRow` for DB row types.
- Use `Option<T>` for nullable fields (e.g., `password_enc: Option<String>`).
- Shared mutable state: `Arc<Mutex<T>>` (std) or `Arc<tokio::sync::Mutex<T>>` (async). Prefer `DashMap<K, V>` for high-concurrency session maps.
- IPC return type is always `Result<T, String>`.

### Error Handling
- **Services**: return `anyhow::Result<T>`; use `?` to propagate and `.context("...")` to add context.
- **Handlers**: call service methods then `.map_err(|e| e.to_string())` at the IPC boundary.
- Guard against invalid input at the handler level; return early with `Err("message".to_string())`.
- DB migrations use `.ok()` to swallow "column already exists" errors:
  ```rust
  sqlx::query("ALTER TABLE servers ADD COLUMN password_enc TEXT")
      .execute(&pool).await.ok();
  ```
- Log errors before or after mapping them: `tracing::error!("context: {}", e);`

### Logging
- Use `tracing` macros throughout: `tracing::info!`, `tracing::warn!`, `tracing::error!`, `tracing::debug!`
- Annotate handlers with `#[tracing::instrument]` to produce structured spans.

### Database Conventions
- Raw `sqlx` queries (no ORM). Every mutable row requires: `id TEXT` (UUID v4), `hlc TEXT` (Hybrid Logical Clock), `deleted BOOLEAN DEFAULT 0` (soft delete — never hard delete).
- Passwords (`password_enc`) are AES-256-GCM encrypted and never sent to the frontend as plaintext. The frontend receives `has_saved_password: bool` instead.

---

## Error Handling — Frontend

- Wrap every `invoke()` call in `try/catch`.
- Surface errors to users via `useToast().error(msg)`.
- Use inline error state (not toast) for form validation to avoid disrupting user input.
- Fire-and-forget calls may swallow errors silently: `sshWrite(sid, data).catch(() => {})`.
- UI strings (including error messages) are in **Brazilian Portuguese**.

---

## Commit Message Format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>
```

Common types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `build`, `ci`, `revert`.

Common scopes: `ssh`, `sync`, `vault`, `sftp`, `pty`, `crdt`, `frontend`, `lib`.

Examples:
```
feat(workspace): Add workspace sync toggle
fix(ssh): Handle reconnect when socket reset
chore: Bump git2 to 0.20
feat!: Switch sync format to new JSON schema
```

- Short description: imperative mood, max ~72 chars, no trailing period.
- Breaking changes: add `BREAKING CHANGE: <description>` in the footer or use `!` after the type.

---

## Key Rules (Quick Reference)

1. **Never access the filesystem, DB, or network from the frontend.** All I/O goes through `invoke()`.
2. **All IPC commands return `Result<T, String>`.** Never return `anyhow::Error` across the IPC boundary.
3. **Hard deletes are forbidden.** Always set `deleted = 1`; never `DELETE FROM`.
4. **Passwords never cross the IPC boundary as plaintext.** Frontend gets `has_saved_password: bool`.
5. **No global state libraries.** Use custom hooks and React context only.
6. **`pnpm` only.** Do not use `npm` or `yarn`.
7. **Streaming data uses Tauri events, not return values.** SSH output → `listen("ssh-output-{id}")`. PTY output → `listen("pty://data/{id}")`.
