# AGENTS.md

> Arquivo gerado por `/init` com análise automática. Edite manualmente para ajustar convenções.

## Projeto

- **Nome:** SSH Config Sync (`ssh-orchestrator`)
- **Descrição:** Cliente SSH/SFTP cross-platform construído com Tauri v2, oferecendo sincronização seletiva de workspaces via repositórios GitHub privados com resolução de conflitos baseada em CRDTs (LWW-Register).

## Stack

- **Linguagem(s):** TypeScript 5.8 (frontend) · Rust 2021 / 1.77+ (backend)
- **Frameworks:** React 19, TailwindCSS 3, Vite 7, Tauri v2, Tokio, SQLx 0.7, russh 0.57

## Gerenciamento de Dependências

> **`pnpm` only** — nunca usar `npm` ou `yarn`.

- **Instalar tudo:** `pnpm install`
- **Adicionar pacote (frontend):** `pnpm add <pacote>`
- **Remover pacote (frontend):** `pnpm remove <pacote>`
- **Adicionar crate (backend):** editar `src-tauri/Cargo.toml` e rodar `cd src-tauri && cargo build`

## Comandos Essenciais

- **Dev server (full-stack):** `pnpm tauri dev`
- **Dev server (frontend only):** `pnpm dev`
- **Build:** `pnpm build`
- **Testes (Rust):** `cd src-tauri && cargo test`
- **Lint (Rust):** `cd src-tauri && cargo clippy`
- **Formato (Rust):** `cd src-tauri && cargo fmt`
- **Type-check (TS):** `tsc` (embutido em `pnpm build`)

## Estrutura de Diretórios

- **Código principal (frontend):** `src/`
- **Código principal (backend):** `src-tauri/src/`
- **Testes:** `src-tauri/src/sync/crdt.rs` (módulos `#[cfg(test)]`) — não há diretório `tests/` separado

## Módulos

### Frontend — `src/`

- **`src/components/Terminal/`** — Emulador de terminal SSH remoto e PTY local com tabs, split-pane e temas (xterm.js)
- **`src/components/Sftp/`** — Gerenciador de arquivos dual-pane (remoto ↔ local) via SFTP com drag & drop
- **`src/components/Servers/`** — Modal de criação e edição de servidores SSH
- **`src/components/Workspaces/`** — Tela de detalhes de workspace com listagem de servidores
- **`src/components/sync/`** — Indicador de progresso da sincronização de workspace
- **`src/components/Sidebar.tsx`** — Barra lateral com lista de workspaces e navegação global
- **`src/components/TitleBar.tsx`** — Barra de título customizada com controles de janela e ações globais
- **`src/components/VaultGuard.tsx`** — Guarda de autenticação do vault; exige master password antes de renderizar a app
- **`src/hooks/`** — Hooks globais: `useTerminalManager`, `useTerminalTheme`, `useToast`, `useAuth`
- **`src/lib/api/`** — Wrappers finos de `invoke()` por domínio: `servers.ts`, `ssh.ts`, `sftp.ts`, `workspaces.ts`, `pty.ts`
- **`src/lib/keybindings.ts`** — Mapa de atalhos de teclado (`KEYBINDINGS`) e helper `matchesBinding`
- **`src/lib/themes.ts`** — Definição de temas de terminal disponíveis

### Backend — `src-tauri/src/`

- **`handlers/`** — Funções IPC `#[tauri::command]`: entry points para workspace, server, ssh, sftp, vault, auth, pty
- **`services/`** — Lógica de negócio: `crypto.rs` (AES-256-GCM/PBKDF2), `db.rs` (SQLite/sqlx), `ssh.rs` (russh), `sftp.rs`, `pty.rs` (portable-pty)
- **`models/`** — Structs compartilhadas com `Serialize`/`Deserialize`: `Workspace`, `Server`, `VaultConfig`
- **`sync/`** — Motor de sincronização: `crdt.rs` (HLC + LWW merge), `git_ops.rs`, `merge.rs`, `repo.rs` (git2)
- **`auth/`** — GitHub OAuth: troca de código, obtenção de token e dados do usuário (`github.rs`)
- **`lib.rs`** — Composição do `AppState`, registro de todos os handlers e bootstrap da aplicação

## Arquitetura

- **Estilo:** Layered IPC (Frontend → Tauri IPC Bridge → Handlers → Services)
- **Descrição:** O frontend React nunca acessa filesystem, banco de dados ou rede diretamente — toda I/O passa por `invoke()`. Dados em stream (output SSH/PTY) chegam ao frontend via eventos Tauri (`listen()`). O `AppState` injeta serviços singleton em todos os handlers via `tauri::State`.

## Variáveis de Ambiente

> Copie `.env.example` para `.env` e ajuste os valores.

- **GitHub OAuth:** `GH_CLIENT_ID`, `GH_CLIENT_SECRET`

## Testes

- **Framework:** Rust `#[cfg(test)]` (nativo — `cargo test`)
- **Diretório:** `src-tauri/src/sync/crdt.rs` (módulo de testes inline) — sem diretório `tests/` separado
- **Executar todos:** `cd src-tauri && cargo test`
- **Filtrar por módulo:** `cd src-tauri && cargo test crdt`
- **Teste específico com stdout:** `cd src-tauri && cargo test <nome_do_teste> -- --nocapture`
- **⚠️ Sem framework de testes frontend** (sem Jest/Vitest)

## Convenções de Código

### TypeScript / Frontend

- **Tamanho máximo de função:** 40 linhas
- **Tamanho máximo de arquivo:** 300 linhas
- **Aninhamento máximo:** 3 níveis
- **Comentários / strings de UI:** Português brasileiro
- **Identificadores (variáveis, funções, classes, tipos):** Inglês
- Toda chamada `invoke<T>()` deve ser tipada explicitamente
- Todo componente declara uma `interface Props {}` local
- `invoke()` sempre envolto em `try/catch`; erros surfaceados via `useToast().error(msg)`
- Fire-and-forget: `sshWrite(sid, data).catch(() => {})`
- **Sem ESLint / Prettier** — `tsconfig.json` com `strict: true` é o único linter
- Imports: caminhos **relativos** (sem path aliases); `import type` para imports somente de tipo
- Nomes: componentes `PascalCase.tsx`, hooks `camelCase.ts` (prefixo `use`), API wrappers `camelCase.ts`, constantes `UPPER_SNAKE_CASE`

### Rust / Backend

- **Edition:** 2021; formatação padrão `rustfmt` (sem `rustfmt.toml`)
- **Todos os handlers IPC retornam `Result<T, String>`** — nunca `anyhow::Error` cruzando a fronteira IPC
- **Services** retornam `anyhow::Result<T>`; usar `?` + `.context("...")`; `.map_err(|e| e.to_string())` no handler
- **Hard deletes proibidos** — sempre soft-delete (`deleted = 1`)
- Senhas nunca trafegam em plaintext pelo IPC — frontend recebe `has_saved_password: bool`
- Estado compartilhado mutável: `Arc<Mutex<T>>` (sync) ou `Arc<tokio::sync::Mutex<T>>` (async); mapas de alta concorrência: `DashMap<K, V>`
- Logging com `tracing`: `tracing::info!`, `warn!`, `error!`, `debug!`; handlers anotados com `#[tracing::instrument]`
- Derivar `Debug, Clone, Serialize, Deserialize` em structs; `sqlx::FromRow` para row types
- Toda linha mutável no banco requer: `id TEXT` (UUID v4), `hlc TEXT` (HLC timestamp), `deleted BOOLEAN DEFAULT 0`

## Commits

Este projeto segue o padrão **Conventional Commits**.
Antes de commitar, carregue a skill de commit:

```
/skill:git-commit-push
```

Ou siga diretamente as regras em `.agents/skills/git-commit-push/SKILL.md`.

**Formato:** `<type>(<scope>): <descrição curta>` — imperativo, máx. ~72 chars, sem ponto final.

**Types:** `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `chore`, `build`, `ci`, `revert`

**Scopes:** `ssh`, `sync`, `vault`, `sftp`, `pty`, `crdt`, `frontend`, `lib`

```
feat(workspace): Add workspace sync toggle
fix(ssh): Handle reconnect when socket reset
feat!: Switch sync format to new JSON schema   # ! = breaking change
```

## Agentes e Skills

| Agente    | Função                                         | Modo                   |
|-----------|------------------------------------------------|------------------------|
| `build`   | Implementa funcionalidades e corrige bugs      | escrita completa       |
| `ask`     | Responde perguntas somente-leitura             | somente-leitura        |
| `plan`    | Cria planos detalhados em `.pi/plans/`         | escrita em .pi/plans/  |
| `quality` | Auditoria de qualidade de código               | bash + leitura         |
| `qa`      | Análise de bugs e edge cases                   | bash + leitura         |
| `test`    | Cria e mantém testes automatizados             | escrita em tests/      |
| `doc`     | Cria documentação técnica em `docs/`           | escrita em docs/       |
