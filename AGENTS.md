# AGENTS.md

## Project Overview
SSH Config Sync is a cross-platform SSH client built with Tauri v2, React 19, and Rust. It features selective workspace syncing, CRDT-based conflict resolution, AES-256-GCM encryption, and a professional terminal with Tabs, Split-Pane, and Theme support.

## Setup Commands
- Install dependencies: `pnpm install`
- Start Tauri development server (Frontend + Backend): `pnpm tauri dev`
- Start frontend dev server only: `pnpm dev`
- Build frontend: `pnpm build`

## Code Style & Technology Stack
### Frontend (`/src`)
- **Framework**: React 19.
- **Language**: TypeScript (strict mode).
- **Styling**: TailwindCSS for styling and UI micro-animations.
- **Terminal**: `xterm.js` with Tabs and Split-Pane support.
- **Themes**: Customizable terminal themes (stored in localStorage).

### Backend (`/src-tauri`)
- **Framework**: Tauri v2 & Rust (1.77+).
- **Database**: SQLite (`sqlx`) with local encryption.
- **Crypto**: `ring` crate (AES-256-GCM + PBKDF2) for security.
- **SSH/SFTP**: `russh` crate.
- **Logging**: Use `tracing` crate for production-grade structured logging.

## Architecture & Security Guidelines
- **Zero-Trust**: Master password must never be stored in plain text or transmitted off the machine.
- **State Consistency**: Data synchronization uses CRDT (Conflict-free Replicated Data Types) logic backed by a private GitHub repository.
- **IPC**: Frontend communicates with the Rust backend primarily through Tauri IPC commands.
