# AGENTS.md

## Projeto

Cliente SSH/SFTP cross-platform (Tauri v2 + React 19 + Rust). Sincronização de workspaces via repositório GitHub privado com CRDT (LWW-Register + HLC).

## Stack

- **Frontend:** TypeScript 5.8, React 19, TailwindCSS 3, Vite 7, xterm.js
- **Backend:** Rust 2021, Tauri v2, Tokio, SQLx 0.7 (SQLite), russh 0.57, git2 0.20, portable-pty 0.8

## Comandos

> **`pnpm` only** — nunca `npm` ou `yarn`.

| Ação | Comando |
|------|---------|
| Dev full-stack | `pnpm tauri dev` |
| Dev frontend only | `pnpm dev` |
| Build | `pnpm build` (roda `tsc && vite build`) |
| Testes Rust | `cd src-tauri && cargo test` |
| Teste específico | `cd src-tauri && cargo test <nome> -- --nocapture` |
| Lint Rust | `cd src-tauri && cargo clippy` |
| Format Rust | `cd src-tauri && cargo fmt` |
| Type-check TS | `tsc --noEmit` (incluso no build) |
| Adicionar crate | Editar `src-tauri/Cargo.toml` → `cd src-tauri && cargo build` |

## Estrutura

```
src/                    # Frontend React
  components/           # UI (Terminal/, Sftp/, Servers/, Workspaces/, sync/)
  hooks/                # Custom hooks (useTerminalManager, useToast, useSftpQueue, etc.)
  lib/api/              # Wrappers de invoke() por domínio (ssh, sftp, pty, vault, auth, servers, workspaces)
src-tauri/src/          # Backend Rust
  handlers/             # Funções #[tauri::command] (IPC entry points)
  services/             # Lógica de negócio (crypto, db, ssh, sftp, pty)
  models/               # Structs de domínio (Workspace, Server, VaultConfig)
  sync/                 # CRDT engine (crdt.rs, merge.rs, git_ops.rs, repo.rs)
  auth/                 # GitHub OAuth (github.rs)
  lib.rs                # AppState, registro de handlers, bootstrap
```

## Arquitetura — o que um agente precisa saber

- **Frontend nunca faz I/O direto** — tudo via `invoke()` (request/response) ou `listen()` (streams SSH/PTY).
- **`AppState`** é o DI container; injeta singleton services via `tauri::State` em todos os handlers.
- **Handlers** retornam `Result<T, String>` — services retornam `anyhow::Result<T>`. Conversão: `.map_err(|e| e.to_string())` no handler.
- **Sync engine:** push/pull são mutex-protegidos (`sync_lock: tokio::sync::Mutex<()>`). Merge é determinístico via HLC timestamp.

## Variáveis de Ambiente

Copie `.env.example` → `.env`. Necessário para OAuth:
- `GH_CLIENT_ID`, `GH_CLIENT_SECRET`

As env vars são lidas em **build time** via `dotenvy` no `build.rs` do Tauri.

## Testes

- Apenas Rust, inline `#[cfg(test)]` em `sync/crdt.rs` e `services/crypto.rs`
- **Sem testes frontend** (sem Jest/Vitest)

## Convenções de Código

### TypeScript

- Sem ESLint/Prettier — `tsconfig.json` strict é o único linter
- Imports: caminhos **relativos**, sem aliases; `import type` para tipos
- `invoke<T>()` sempre tipado e em `try/catch`; erros via `useToast().error()`
- Componentes: `interface Props {}` local; nomes `PascalCase.tsx`
- Hooks: `camelCase.ts` com prefixo `use`
- Comentários e UI strings: **português brasileiro**; identificadores: **inglês**
- Max: 40 linhas/função, 300 linhas/arquivo, 3 níveis de aninhamento

### Rust

- Handlers IPC: `Result<T, String>` — nunca `anyhow::Error` na fronteira
- **Hard deletes proibidos** — sempre soft-delete (`deleted = true`)
- Toda row mutável: `id TEXT` (UUID v4), `hlc TEXT`, `deleted BOOLEAN DEFAULT 0`
- Senhas/chaves SSH **nunca** trafegam em plaintext pelo IPC
- Concorrência: `DashMap` para mapas, `Arc<tokio::sync::Mutex<T>>` para async
- Logging: `tracing` (`info!`, `warn!`, `error!`, `debug!`)
- Derivar `Debug, Clone, Serialize, Deserialize` em structs; `sqlx::FromRow` em rows

## Commits

**Conventional Commits:** `<type>(<scope>): <descrição curta>` — imperativo, ~72 chars, sem ponto final.

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `build`, `ci`, `revert`

**Scopes:** `ssh`, `sync`, `vault`, `sftp`, `pty`, `crdt`, `frontend`, `lib`

Antes de commitar, carregue a skill: `/skill:git-commit-push`
