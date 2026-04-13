## Relatório de Qualidade de Código
**Data:** 2026-04-13
**Escopo:** Repositório completo
**Stack detectada:** Rust (Tauri v2 backend) + TypeScript/React 19 (frontend)

---

### Ferramentas Automáticas

#### TypeScript — `tsc && vite build`
Sem erros de tipo. Um aviso do Vite:
```
(!) Some chunks are larger than 500 kB after minification.
dist/assets/index-CGYzOKO_.js  648.01 kB │ gzip: 174.98 kB
```
Para app desktop, sem impacto real. Resolvível com code-splitting dinâmico (`React.lazy`).

#### Rust — `cargo test`
13 testes passando em 3 suites. Cobertura restrita ao módulo `sync::crdt`.

#### Rust — `cargo clippy`
0 erros. **16 warnings** em 7 arquivos (detalhados na seção Rust abaixo).

#### Rust — `cargo fmt --check`
**FALHOU.** 58 diffs de formatação pendentes em 13 arquivos — `cargo fmt` nunca foi executado antes do commit.
Arquivos afetados:
`build.rs`, `auth/github.rs`, `handlers/server.rs`, `handlers/sftp.rs`, `handlers/ssh.rs`,
`lib.rs`, `services/db.rs`, `services/sftp.rs`, `services/ssh.rs`, `sync/merge.rs`, `sync/repo.rs`

---

### Arquitetura

- **[ERRO] `src/components/Sidebar.tsx:2,88,89` — `invoke()` direto sem wrapper em `lib/api/`**
  O componente importa `invoke` de `@tauri-apps/api/core` e chama `is_vault_configured` / `is_vault_locked` diretamente. Conforme as convenções do AGENTS.md, todo `invoke()` deve estar em `lib/api/`. Há dois locais de manutenção para o mesmo comando vault (aqui e em `VaultGuard.tsx`).

- **[ERRO] `src/components/VaultGuard.tsx:2,377,394,412` — `invoke()` direto sem wrapper em `lib/api/`**
  Três comandos IPC (`setup_vault`, `unlock_vault`, `import_synced_vault`) chamados diretamente sem passar por `lib/api/`. Ausência de wrappers impede reutilização e tipagem centralizada.

- **[AVISO] `src/components/Workspaces/WorkspaceDetail.tsx:19–21` — interface `Props.workspace` não inclui `sync_enabled`**
  A interface `Props` declara `workspace: { id: string; name: string; color: string }`, omitindo `sync_enabled` que já existe em `Workspace` de `lib/api/workspaces.ts`. Isso força 3 asserções `as any` no mesmo componente para acessar o campo. Corrigir a interface eliminaria todos os `as any` locais.

---

### Rust — Estilo e Convenções

- **[AVISO] `cargo fmt` não executado — 13 arquivos com formatação inconsistente**
  Trailing whitespace em linhas vazias, ordem de imports fora do padrão `rustfmt`, quebras de linha irregulares. Executar `cargo fmt` resolve todos os 58 diffs.

- **[AVISO] `#[tracing::instrument]` ausente em 34 dos 38 handlers IPC**
  AGENTS.md exige: *"Annotate handlers with `#[tracing::instrument]`"*. Apenas `handlers/vault.rs` (7 handlers) tem a anotação. Os seguintes módulos estão sem:
  - `handlers/server.rs` — 4 handlers (`get_servers`, `create_server`, `update_server`, `delete_server`)
  - `handlers/workspace.rs` — 4 handlers
  - `handlers/ssh.rs` — 4 handlers
  - `handlers/sftp.rs` — 15 handlers
  - `handlers/pty.rs` — 4 handlers
  - `handlers/auth.rs` — 3 handlers

- **[AVISO] `services/crypto.rs:33` — `&PathBuf` em vez de `&Path` (clippy)**
  Assinatura `pub fn new(app_data_dir: &PathBuf)` deveria ser `&Path` conforme a lint `clippy::ptr_arg`.

- **[AVISO] `handlers/ssh.rs:15` — função com 9 argumentos (`ssh_connect`) (clippy)**
  Clippy limita a 7. Considerar agrupar os parâmetros de credencial e PTY em structs.

- **[AVISO] `handlers/server.rs:105,106` e outros 6 locais — referência redundante em `.bind()` (clippy)**
  `.bind(&server.id)`, `.bind(&server.workspace_id)` etc. — o argumento já é referência que implementa o trait necessário; o `&` externo é redundante.

- **[AVISO] `services/sftp.rs:253` — `Iterator::last()` em `DoubleEndedIterator` (clippy)**
  `remote_path.split('/').last()` percorre o iterador inteiro. Usar `.next_back()` ou `rsplit('/').next()` é O(1).

- **[AVISO] `sync/mod.rs:420` — `format!("https://dummy.invalid")` inútil (clippy)**
  Macro `format!` sem argumentos de formatação. Usar `"https://dummy.invalid".to_string()` ou `String::from(...)`.

- **[AVISO] `services/ssh.rs:83`, `services/sftp.rs:56`, `services/pty.rs:31` — `impl Default` ausente (clippy × 3)**
  As três structs de serviço têm `new()` sem parâmetros; clippy sugere implementar `Default`.

- **[AVISO] `services/crypto.rs` — múltiplos `unwrap()` em `RwLock` (linhas 65, 70, 75, 200, 208, 266)**
  `state.read().unwrap()` e `state.write().unwrap()` paniquam se o `RwLock` for envenenado (panic em outra thread enquanto o lock está held). AGENTS.md lista `unwrap()` como aviso. Para `RwLock`, o padrão recomendado é usar `unwrap_or_else(|e| e.into_inner())` ou considerar `parking_lot::RwLock` que não envenena.

- **[AVISO] `handlers/auth.rs:17,41,87,112` — `GITHUB_TOKEN.lock().unwrap()` em Mutex global**
  Mesmo risco de envenenamento. Se qualquer thread panicar segurando o lock, todas as chamadas subsequentes paniquam.

- **[AVISO] `handlers/server.rs:111` — `serde_json::to_string(&server.tags).unwrap()`**
  Serialização de `Vec<String>` dificilmente falha, mas `.unwrap()` não converte o erro para `String` via `map_err` como o restante do handler faz. Inconsistente com o padrão do arquivo.

- **[AVISO] `lib.rs:43` — referência desnecessária `&handle` (clippy)**
  `DbService::new(&handle)` onde `handle` já é referência; gera uma dupla referência desnecessária.

---

### TypeScript — Estilo e Convenções

- **[AVISO] `src/components/VaultGuard.tsx:287` — `useToast() as any`**
  `useToast()` retorna um tipo concreto; o cast para `any` remove a segurança de tipos. A interface de `useToast` deve ser consultada para usar o tipo correto.

- **[AVISO] `src/components/Workspaces/WorkspaceDetail.tsx:113` — `} as any)` em `onWorkspaceUpdated`**
  Consequência direta da interface `Props.workspace` incompleta (ver Arquitetura). Corrigir a interface elimina este cast.

- **[AVISO] `src/components/Servers/AddServerModal.tsx:389` — `child as React.ReactElement<any>`**
  `<any>` pode ser tipado com o tipo real do elemento filho.

- **[AVISO] `src/hooks/useAuth.ts:40,67,78` — `console.error` em código de produção**
  AGENTS.md: erros devem ser surfaceados via `useToast().error(msg)`. Três ocorrências de `console.error` em `useAuth` ficam invisíveis para o usuário.

- **[AVISO] `src/components/TitleBar.tsx:90,110` — `console.error` em código de produção**
  Os erros de pull/push já são exibidos via `toast.error`, mas também são enviados para `console.error`. A linha de `console.error` é redundante e deve ser removida.

- **[AVISO] `src/components/VaultGuard.tsx:336` — `console.error` em código de produção**
  Mesma situação — erro silencioso para o usuário final.

- **[SUGESTÃO] `src/hooks/useTerminalManager.ts:22` — `let _tabCounter = 0` (variável global de módulo)**
  O contador global não reseta entre hot-reloads no dev; IDs de abas podem colidir se o módulo for reimportado. Usar `crypto.randomUUID()` ou `Date.now() + Math.random()` é mais robusto.

- **[SUGESTÃO] `src/hooks/useAuth.ts:1–7` — comentário de cabeçalho desatualizado**
  O bloco de comentário diz *"stub para autenticação GitHub OAuth — Substituir a lógica de login/logout pela integração real com OAuth quando implementado"*. O OAuth já está implementado. O comentário induz ao erro de que o arquivo ainda é um stub.

---

### Segurança

- **[AVISO] `services/crypto.rs:179,248,309` — `nonce_slice.try_into().unwrap()`**
  Ocorre após `split_at(NONCE_LEN)` onde o tamanho é verificado no início da função. O `unwrap()` nunca falha na prática, mas o padrão recomendado é usar `?` com um erro explícito para manter consistência com o restante do serviço.

---

### Manutenção

- **[AVISO] Bundle TypeScript único de 648KB — sem code splitting**
  Toda a aplicação é carregada em um único chunk. Para um app desktop isso não é crítico, mas dificulta a análise de performance. Componentes grandes como `VaultGuard.tsx` (832 linhas), `SftpDualPane.tsx` (799 linhas) e `Sidebar.tsx` (700 linhas) são candidatos a `React.lazy()`.

- **[SUGESTÃO] Componentes acima de 500 linhas de JSX**
  Conforme o checklist do AGENTS.md (>200 linhas → aviso). Os seguintes excedem significativamente:
  | Arquivo | Linhas |
  |---|---|
  | `VaultGuard.tsx` | 832 |
  | `SftpDualPane.tsx` | 799 |
  | `Sidebar.tsx` | 700 |
  | `WorkspaceDetail.tsx` | 590 |
  | `SftpPanel.tsx` | 452 |
  | `AddServerModal.tsx` | 432 |
  | `Terminal.tsx` | 349 |
  | `TitleBar.tsx` | 329 |

  `VaultGuard.tsx` e `Sidebar.tsx` misturam múltiplas responsabilidades (autenticação, vault status, lógica de edição inline, modais de confirmação). Cada modal interno poderia ser um componente separado.

- **[SUGESTÃO] Wrappers `lib/api/` incompletos — vault e auth**
  Não existem arquivos `lib/api/vault.ts` nem `lib/api/auth.ts`, forçando `invoke()` direto nos componentes. Criar esses wrappers completaria a camada de API e eliminaria as violações de arquitetura listadas acima.

---

### Resumo

| Categoria | Erros | Avisos | Sugestões |
|---|:---:|:---:|:---:|
| Arquitetura | 2 | 1 | — |
| Rust — Estilo/Convenções | — | 12 | — |
| TypeScript — Estilo/Convenções | — | 5 | 2 |
| Segurança | — | 1 | — |
| Manutenção | — | 1 | 2 |
| **Total** | **2** | **20** | **4** |

**Próximos passos sugeridos (por prioridade):**

1. `cargo fmt` — resolve 58 diffs de formatação com um único comando
2. Criar `lib/api/vault.ts` e `lib/api/auth.ts` — elimina os 2 erros de arquitetura e os `invoke()` diretos
3. Corrigir interface `Props.workspace` em `WorkspaceDetail.tsx` — elimina todos os `as any` locais
4. Adicionar `#[tracing::instrument]` nos 34 handlers sem anotação
5. Resolver os 16 warnings do clippy — todos triviais (≤ 1 linha cada)
6. Remover `console.error` de produção em `useAuth.ts`, `TitleBar.tsx` e `VaultGuard.tsx`

---
_Relatório salvo em: `.pi/audit/2026-04-13-quality-repositorio-completo.md`_
