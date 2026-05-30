# AGENTS.md

## Projeto

Cliente SSH/SFTP/RDP cross-platform (Tauri v2 + React 19 + Rust). Sincroniza workspaces via repositorio GitHub privado com CRDT (LWW-Register + HLC). RDP via sidecar C (FreeRDP 3.26.0 headless).

## Stack

- **Frontend:** TypeScript 5.8, React 19, TailwindCSS 3, Vite 7, xterm.js
- **Backend:** Rust 2021, Tauri v2, Tokio, SQLx 0.7 (SQLite), russh 0.57, git2 0.20, portable-pty 0.8
- **RDP sidecar:** C11, FreeRDP 3.26.0 (static libs, headless), CMake, cJSON

## Comandos

> **`pnpm` only** — nunca `npm` ou `yarn`.

| Acao | Comando |
|------|---------|
| Dev full-stack | `pnpm tauri dev` |
| Dev frontend only | `pnpm dev` |
| Build frontend | `pnpm build` (roda `tsc && vite build`) |
| Testes Rust | `cd src-tauri && cargo test` |
| Teste especifico | `cd src-tauri && cargo test <nome> -- --nocapture` |
| Lint Rust | `cd src-tauri && cargo clippy` |
| Format Rust | `cd src-tauri && cargo fmt` |
| Type-check TS | `tsc --noEmit` (incluso no build) |
| Build RDP sidecar | `cd rdp-bridge-c && cmake -B build && cmake --build build` |
| Rebuild RDP sidecar | `cd rdp-bridge-c && cmake --build build` |

### Prerequisitos do RDP sidecar (system deps)

```
libssl-dev zlib1g-dev libicu-dev cmake
```

FreeRDP 3.26.0 source fica em `freerdp-3.26.0/`. Precisa ser compilado uma vez como static libs:

```bash
cd freerdp-3.26.0 && mkdir -p build && cd build
cmake .. -DWITH_SERVER=OFF -DWITH_CLIENT_INTERFACE=OFF -DWITH_SHADOW=OFF \
  -DWITH_SAMPLE=OFF -DWITH_PLATFORM_SERVER=OFF -DWITH_X11=OFF -DWITH_WAYLAND=OFF \
  -DWITH_KRB5=OFF -DBUILD_SHARED_LIBS=OFF -DCMAKE_POSITION_INDEPENDENT_CODE=ON
make -j$(nproc)
```

## Estrutura

```
src/                    # Frontend React
  components/           # UI (Terminal/, Sftp/, Servers/, Rdp/, Workspaces/, sync/)
  hooks/                # Custom hooks (useTerminalManager, useToast, useSftpQueue)
  lib/api/              # Wrappers de invoke() por dominio (ssh, sftp, pty, rdp, vault, auth, servers, workspaces)
src-tauri/src/          # Backend Rust
  handlers/             # Funcoes #[tauri::command] (IPC entry points)
  services/             # Logica de negocio (crypto, db, ssh, sftp, pty, rdp)
  models/               # Structs de dominio (Workspace, Server, VaultConfig)
  sync/                 # CRDT engine (crdt.rs, merge.rs, git_ops.rs, repo.rs)
  auth/                 # GitHub OAuth (github.rs)
  lib.rs                # AppState, registro de handlers, bootstrap
rdp-bridge-c/           # Sidecar C (FreeRDP) — binario: rdp-bridge-c/build/rdp-bridge
  src/                  # main.c, protocol.c/h, session.c/h, display.c/h, clipboard.c/h
  deps/cJSON/           # JSON parser (MIT, single-file)
freerdp-3.26.0/         # FreeRDP source (versionado); build/ gitignored
```

## Arquitetura

- **Frontend nunca faz I/O direto** — tudo via `invoke()` (request/response) ou `listen()` (streams SSH/PTY/RDP).
- **`AppState`** (lib.rs) e o DI container; injeta singleton services via `tauri::State` em todos os handlers.
- **Handlers** retornam `Result<T, String>` — services retornam `anyhow::Result<T>`. Conversao: `.map_err(|e| e.to_string())` no handler.
- **Sync engine:** push/pull sao mutex-protegidos (`sync_lock: tokio::sync::Mutex<()>`). Merge e deterministico via HLC timestamp.

### RDP sidecar (rdp-bridge-c)

- Binario separado, comunicacao via **stdin/stdout** com JSON newline-delimited (ndjson).
- Tauri spawna o processo; `services/rdp.rs` gerencia lifecycle (DashMap de sessoes, mpsc channels).
- **stdout** = eventos do sidecar: `connected`, `frame` (dirty rect RGBA base64), `disconnected`, `error`, `clipboard_received`, `resolution`.
- **stdin** = comandos: `connect`, `disconnect`, `mouse`, `key`, `unicode`, `clipboard_set`, `resize`.
- Frames sao RGBA32 raw (sem compressao); frontend renderiza via `putImageData` direto no canvas.
- Display Control channel: resize dinamico via `SendMonitorLayout`. Servidor pode fazer deactivate/reactivate (Windows); o event loop sobrevive a isso.
- Clipboard: bidirecional via cliprdr (CF_UNICODETEXT).
- Path resolution em dev: `rdp-bridge-c/build/rdp-bridge` (relativo ao project root, detectado subindo 3 niveis de `src-tauri/target/debug/`).

## Variaveis de Ambiente

Copie `.env.example` -> `.env`. Necessario para OAuth:
- `GH_CLIENT_ID`, `GH_CLIENT_SECRET`

Env vars sao lidas em **build time** via `dotenvy` no `build.rs` do Tauri.

## Testes

- Apenas Rust, inline `#[cfg(test)]` em `sync/crdt.rs` e `services/crypto.rs`
- **Sem testes frontend** (sem Jest/Vitest)

## Convencoes de Codigo

### TypeScript

- Sem ESLint/Prettier — `tsconfig.json` strict e o unico linter
- Imports: caminhos **relativos**, sem aliases; `import type` para tipos
- `invoke<T>()` sempre tipado e em `try/catch`; erros via `useToast().error()`
- Componentes: `interface Props {}` local; nomes `PascalCase.tsx`
- Hooks: `camelCase.ts` com prefixo `use`
- Comentarios e UI strings: **portugues brasileiro**; identificadores: **ingles**
- Max: 40 linhas/funcao, 300 linhas/arquivo, 3 niveis de aninhamento

### Rust

- Handlers IPC: `Result<T, String>` — nunca `anyhow::Error` na fronteira
- **Hard deletes proibidos** — sempre soft-delete (`deleted = true`)
- Toda row mutavel: `id TEXT` (UUID v4), `hlc TEXT`, `deleted BOOLEAN DEFAULT 0`
- Senhas/chaves SSH **nunca** trafegam em plaintext pelo IPC
- Concorrencia: `DashMap` para mapas, `Arc<tokio::sync::Mutex<T>>` para async
- Logging: `tracing` (`info!`, `warn!`, `error!`, `debug!`)
- Derivar `Debug, Clone, Serialize, Deserialize` em structs; `sqlx::FromRow` em rows

### C (rdp-bridge-c)

- C11 standard; `-Wall -Wextra -Wno-unused-parameter`
- stdout exclusivo para protocolo JSON — logs vao para stderr via `fprintf(stderr, ...)`
- Sessoes isoladas em pthreads; input via ring buffer (256 slots) com mutex
- Nunca bloquear a thread principal (stdin reader)

## Commits

**Conventional Commits:** `<type>(<scope>): <descricao curta>` — imperativo, ~72 chars, sem ponto final.

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `build`, `ci`, `revert`

**Scopes:** `ssh`, `sync`, `vault`, `sftp`, `pty`, `rdp`, `crdt`, `frontend`, `lib`

Antes de commitar, carregue a skill: `/skill:git-commit-push`
