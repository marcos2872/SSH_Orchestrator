# SSH Config Sync - Developer Guide

Welcome to the **SSH Config Sync** (also referred to as SSH Orchestrator) codebase. This project is a professional-grade, cross-platform SSH/SFTP client built with **Tauri v2**, **React 19**, and **Rust**.

## 🚀 Project Overview

The application provides a secure environment for managing SSH connections and SFTP file transfers, with a focus on seamless synchronization across devices using private GitHub repositories and Conflict-free Replicated Data Types (CRDTs).

### Core Technology Stack
- **Frontend:** React 19, TypeScript, TailwindCSS, Xterm.js (Terminal), Lucide React (Icons).
- **Backend:** Rust, Tauri v2, Tokio (Async runtime).
- **SSH/SFTP:** `russh` (Rust SSH implementation).
- **Security:** `ring` (AES-256-GCM + PBKDF2), Zero-Knowledge Vault architecture.
- **Database:** SQLite with `sqlx` (Encrypted local storage).
- **Sync:** Git-based storage for encrypted blobs, CRDT-based merging.

## 📁 Project Structure

### Backend (`src-tauri/src/`)
- `lib.rs`: Main entry point, service initialization, and Tauri command registration.
- `services/`: Core logic (SSH, SFTP, Database, Crypto/Vault).
- `handlers/`: Tauri command handlers that bridge the frontend and services.
- `models/`: Data structures and database entities.
- `sync/`: CRDT and Git-based synchronization logic.
- `auth/`: GitHub OAuth integration.

### Frontend (`src/`)
- `App.tsx`: Root component, manages high-level UI state (tabs, splits, workspaces).
- `components/`:
    - `Terminal/`: Xterm.js integration and tab workspace.
    - `Sftp/`: Dual-pane file manager.
    - `VaultGuard.tsx`: Security layer protecting the app until the Vault is unlocked.
- `hooks/`: Custom React hooks (e.g., `useTerminalManager`, `useAuth`, `useToast`).
- `lib/api/`: Frontend wrappers for Tauri `invoke` calls.

## 🛠️ Building and Running

### Prerequisites
- **Rust:** 1.77+
- **Node.js:** 18+ (pnpm recommended)

### Commands
- **Install dependencies:** `pnpm install`
- **Development mode:** `pnpm tauri dev`
- **Build production app:** `pnpm tauri build`
- **Linting:** `pnpm lint` (if configured)
- **Type Checking:** `pnpm build` (runs `tsc`)

## 💡 Development Conventions

### Backend (Rust)
- **Async First:** Almost all handlers and services are `async` using `tokio`.
- **Error Handling:** Use `anyhow::Result` for application logic and `thiserror` for library-style error definitions.
- **State Management:** Services are managed by Tauri's state (`AppState`). Access them in handlers via `State<'_, AppState>`.
- **Logging:** Use `tracing` for structured logging. Avoid `println!`.
- **Security:** Never log sensitive data (passwords, private keys). Encrypt all credentials before storing in the database using `CryptoService`.

### Frontend (React)
- **Component Style:** Functional components with TypeScript.
- **Styling:** TailwindCSS for all UI components. Avoid inline styles unless dynamic.
- **Communication:** Use the wrappers in `src/lib/api/` instead of calling `invoke` directly.
- **State:** Prefer local state for UI, but use custom hooks (like `useTerminalManager`) for cross-cutting concerns.
- **Terminal:** Xterm.js instances are managed within `Terminal.tsx`. Data is streamed via Tauri events (`ssh://data/{sid}`).

### Commit messages & Git workflow (Conventional Commits)
To keep history clear and to enable tooling (changelog generation, semantic releases, CI automation), we use the Conventional Commits specification for all commit messages.

- Commit message format:
  - `<type>(scope?): subject`
  - Example: `feat(workspace): support encrypted sync`
- Allowed `type` values (use one per commit):
  - `feat` — a new feature
  - `fix` — a bug fix
  - `docs` — documentation only changes
  - `style` — formatting, missing semicolons, etc (no code change)
  - `refactor` — code change that neither fixes a bug nor adds a feature
  - `perf` — a code change that improves performance
  - `test` — adding or updating tests
  - `chore` — maintenance tasks (build, tooling)
  - `build` — changes that affect the build system or external dependencies
  - `ci` — CI configuration and scripts
  - `revert` — reverts a previous commit

- Message body and footer:
  - Keep the `subject` short and imperative (recommended <= 50 characters).
  - If more context is needed, add a blank line then a body wrapped at ~72 characters.
  - Use the footer for metadata: `BREAKING CHANGE: description` or issue references (e.g., `Closes #123`).
  - Use `BREAKING CHANGE:` in the footer (or `!` after type/scope, e.g. `feat!: ...`) to indicate breaking API changes.

- Scope:
  - Optional, but helpful. Use a short noun describing area affected, e.g., `backend`, `vault`, `sync`, `ui`, `sftp`.

- Examples:
  - `feat(sync): add pull-then-merge with CRDT`
  - `fix(ssh): avoid panic on session drop`
  - `docs: update contributing guide`
  - `perf(db): reduce queries in workspace load`
  - `chore: update rustfmt config`

- Best practices:
  - One logical change per commit. If a change touches multiple concerns, split into multiple commits.
  - Use PRs for review; squash or rebase as your team prefers, but ensure the final commit message on merge follows Conventional Commits.
  - Do not include secrets or sensitive data in commits.
  - Link PRs to issues using `Closes #NNN` in the commit or PR description when appropriate.

Following these rules improves readability of history, enables automated releases and changelogs, and makes reviews easier.

## 🔒 Security Architecture (Vault)
The app uses a **Zero-Knowledge** architecture:
1.  **DEK (Data Encryption Key):** A random 32-byte key generated locally. Used to encrypt all sensitive data in SQLite.
2.  **KEK (Key Encryption Key):** Derived from the user's **Master Password** using PBKDF2 with 100k iterations.
3.  **Vault:** The DEK is stored encrypted by the KEK in `vault.json`.
4.  The Master Password is never stored on disk or sent to any server.

## ☁️ Sync Logic
- Workspaces can be "Local-only" or "Cloud-synced".
- Synced workspaces are pushed to a private GitHub repository.
- Conflicts are resolved using a Last-Write-Wins (LWW) Register CRDT approach.
