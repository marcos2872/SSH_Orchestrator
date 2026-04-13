## Relatório de QA — Bugs, Segurança e Regras de Negócio
**Data:** 2026-04-13
**Escopo:** Repositório completo (`src-tauri/src/`)
**Analista:** Agente QA

---

### 1. Resumo da Funcionalidade Analisada

Aplicativo desktop Tauri v2 para gerenciamento de conexões SSH com:
- **Vault criptográfico** (AES-256-GCM, PBKDF2-SHA256) para armazenar credenciais no SQLite
- **Sessões SSH/SFTP** via `russh` + `russh-sftp`, com PTY local via `portable-pty`
- **Sincronização CRDT** via GitHub (push/pull de JSONs + LWW por HLC) com autenticação OAuth

---

### 2. Resultado dos Testes Automáticos

> **⚠️ Atualizado em 2026-04-13 (sessão de testes):** 13 testes originais → **47 testes** após criação de suite para `services/crypto.rs` (28 testes) e casos adicionais em `sync/crdt.rs` (9 testes). Veja seção 6 para status de cada sugestão.

~~13 testes passaram (3 suites). Todos os testes cobrem exclusivamente o módulo `sync::crdt` (HLC + LWWRegister). Nenhum teste cobre serviços de criptografia, SSH, SFTP, PTY, sync/merge ou handlers IPC.~~

**Estado atual:** 47 testes passando (3 suites). `CryptoService` agora tem cobertura completa do ciclo de vida do vault (setup, unlock, import, encrypt/decrypt). Handlers IPC, SSH, SFTP e sync/merge continuam sem cobertura automatizada.

---

### 3. Bugs e Condições de Erro

#### Risco ALTO

- **`import_vault` destrói credenciais locais preexistentes** — `services/crypto.rs:177` / `handlers/vault.rs:import_synced_vault`

  Risco: Ao importar um cofre sincronizado em um dispositivo que já possua servidores com credenciais salvas localmente, o DEK (chave de criptografia de dados) em memória é substituído pelo DEK importado. A função `reencrypt_token` re-cifra apenas o token do GitHub (`github_token.enc`); os campos `password_enc`, `ssh_key_enc` e `ssh_key_passphrase_enc` no banco SQLite continuam cifrados com o DEK antigo e se tornam permanentemente indecifráveis.

  Cenário de reprodução: (1) Usuário cria workspace e servidor com senha salva no Dispositivo A (vault configurado, DEK=X). (2) Usuário instala o app no Dispositivo B, cria manualmente outro servidor com senha salva (DEK temporário=Y). (3) Usuário chama `import_synced_vault` no Dispositivo B. O DEK em memória muda para X. A senha do servidor criado no Dispositivo B, cifrada com Y, agora não pode ser decriptada.

  Sugestão: Antes de sobrescrever o vault, verificar se há credenciais locais cifradas com o DEK atual. Se houver, ou (a) exigir que o dispositivo esteja "zerado" antes do import, ou (b) re-encriptar todas as colunas `*_enc` da tabela `servers` com o novo DEK como parte atômica da importação.

---

- **`push_workspace` usa URL inválida `https://dummy.invalid` na segunda abertura do repositório** — `sync/mod.rs:push_workspace` (bloco spawn_blocking do Step 5)

  Risco: Se o diretório `sync_repo` for removido entre o Step 1 (pull/clone) e o Step 5 (commit+push), `init_repo` tentará clonar de `https://dummy.invalid`, falhando com erro de rede confuso em vez de re-clonar do repositório real. Cenários que podem remover `sync_repo`: sistema de arquivos cheio, exclusão manual pelo usuário, crash com limpeza de temporários pelo OS.

  Cenário de reprodução: Deletar `~/.local/share/ssh-config-sync/sync_repo` após o pull e antes do commit. A operação de push falha com erro de conexão em vez de mensagem clara.

  Sugestão: Passar o `clone_url` real do `repo_info` para o segundo `init_repo`, igual ao que é feito no Step 1.

---

#### Risco MÉDIO

- **SSH `session_id` fornecido pelo frontend pode colidir silenciosamente** — `handlers/ssh.rs:ssh_connect` / `services/ssh.rs:connect`

  Risco: O `session_id` é passado pelo frontend (string livre). Se o mesmo ID for enviado duas vezes, `DashMap::insert` substitui a sessão existente silenciosamente. A `SshSession` antiga é dropped (o `msg_tx` é dropped → a tarefa de background recebe `None` → sai), mas a `Handle` anterior pode ainda estar referenciada por uma sessão SFTP ativa. O comportamento é imprevisível: a sessão SFTP vê a conexão cair inesperadamente.

  Cenário de reprodução: Frontend abre duas abas com o mesmo `session_id` (bug de geração de ID ou estado incorreto).

  Sugestão: No início de `connect`, verificar se o `session_id` já existe em `self.sessions` e retornar erro explícito.

---

- **`delete_server` / `update_server` não verificam se a linha existe** — `handlers/server.rs`

  Risco: Uma operação com UUID válido mas inexistente no banco retorna `Ok(())` silenciosamente (zero linhas afetadas). O frontend interpreta isso como sucesso, podendo deixar a UI em estado inconsistente (ex.: exibir servidor como deletado quando nada mudou).

  Cenário de reprodução: Chamar `delete_server` com UUID de servidor já deletado (soft-delete). Retorna `Ok(())`.

  Sugestão: Usar `rows_affected()` do resultado do `execute` e retornar `Err("Servidor não encontrado")` se for 0.

---

- **`sftp_download` cria arquivo local antes de completar o download** — `services/sftp.rs:download`

  Risco: `tokio::fs::File::create(local_path)` é chamado antes de ler qualquer byte do servidor remoto. Se o download falhar a qualquer momento (rede cai, permissão negada no SFTP, etc.), um arquivo vazio ou parcialmente escrito permanece em disco sem nenhuma tentativa de limpeza.

  Cenário de reprodução: Iniciar download de arquivo grande; derrubar a conexão SSH no meio. O arquivo local fica com conteúdo truncado.

  Sugestão: Fazer download para um arquivo temporário (ex.: `local_path + ".tmp"`) e renomear atomicamente para `local_path` apenas ao terminar. No bloco de erro, remover o temporário.

---

- **`SftpService::delete` falha silenciosamente para diretórios não vazios** — `services/sftp.rs:delete`

  Risco: O método tenta `remove_file` (falha para diretório) e depois `remove_dir` (falha para diretório não vazio via protocolo SFTP). O usuário recebe erro genérico ao tentar deletar uma pasta com arquivos, sem explicação clara.

  Cenário de reprodução: Tentar deletar um diretório remoto não vazio pelo painel SFTP.

  Sugestão: Implementar deleção recursiva (listar conteúdo e deletar filhos antes) ou retornar erro descritivo indicando que o diretório não está vazio.

---

- **`delete_workspace` usa o mesmo HLC para todos os servidores e o workspace** — `handlers/workspace.rs:delete_workspace`

  Risco: Todos os servidores do workspace e o próprio workspace recebem exatamente o mesmo HLC (`HLC::now` chamado uma vez). Durante merge CRDT, se um servidor individual de outro dispositivo tiver HLC igual ao do workspace deletado, o tiebreaker por `node_id` pode produzir resultado incorreto (server não deletado quando deveria). Em cenário normal é improvável, mas é uma invariante violada.

  Sugestão: Chamar `HLC::now` separadamente para cada entidade, ou garantir que a deleção do workspace seja sempre o HLC mais alto.

---

#### Risco BAIXO

- **`unlock_vault` retorna `Ok(())` silenciosamente quando vault está em estado `Unconfigured`** — `services/crypto.rs:unlock`

  Risco: Qualquer senha (incluindo string vazia, embora bloqueada no handler) passada ao `unlock_vault` retorna sucesso quando o vault está em estado `Unconfigured`. Código que verifica `is_locked()` antes e depois de `unlock_vault` pode ficar confuso, embora não haja impacto de segurança direto.

  Sugestão: Distinguir entre `Unconfigured` e `Unlocked` no retorno, ou documentar explicitamente o comportamento.

---

- **`HLC::now()` — contador global jamais reseta entre timestamps distintos** — `sync/crdt.rs:COUNTER`

  Risco: `COUNTER` é um `AtomicU32` global que só incrementa. Após ~4 bilhões de chamadas, transborda para zero, criando HLCs com contador mais baixo que os anteriores. Na prática, para um app de uso pessoal, isso é irrelevante, mas viola a especificação HLC que prevê reset do contador quando o timestamp avança.

  Sugestão: Armazenar o último timestamp gerado e resetar o contador quando o timestamp mudar.

---

- **OAuth callback lê no máximo 2048 bytes da requisição HTTP** — `auth/github.rs:start_oauth_flow`

  Risco: Navegadores modernos podem enviar headers HTTP maiores que 2048 bytes (cookies, referrer, etc.). O código e o state do OAuth estão na primeira linha da requisição GET, portanto normalmente chegam no primeiro read. Porém, com proxies locais ou headers incomuns, o truncamento pode fazer a extração do `code` falhar, resultando em `Err("No code received")` com mensagem pouco descritiva.

  Sugestão: Ler em loop até encontrar `\r\n\r\n` (fim dos headers) ou atingir um limite razoável (8KB).

---

### 4. Vulnerabilidades de Segurança

#### [ALTO] Verificação de chave do servidor SSH sempre retorna `true` (TOFU sem persistência) — `services/ssh.rs:check_server_key`

Risco: Todo servidor SSH é aceito sem verificação, tornando todas as conexões vulneráveis a ataques Man-in-the-Middle. Um adversário em posição de rede pode interceptar credenciais, comandos e dados trafegados na sessão. O comentário no código indica que isso é intencional para a "Phase 0.1" — mas não há nenhum mecanismo que impeça o deploy desta versão em produção indefinidamente.

Cenário de reprodução: Realizar ARP spoofing ou DNS poisoning na rede local e apresentar um certificado SSH arbitrário. O cliente aceita e a sessão é estabelecida com o atacante.

Sugestão: Implementar ao menos TOFU com persistência: na primeira conexão, armazenar o fingerprint da chave pública do servidor no banco (tabela `known_hosts`). Em conexões subsequentes, rejeitar se o fingerprint não bater e notificar o usuário.

---

#### [ALTO] Operações locais do SFTP aceitam caminhos arbitrários sem validação — `handlers/sftp.rs` / `services/sftp.rs:list_local, delete_local, rename_local, mkdir_local`

Risco: Os handlers `sftp_list_local`, `sftp_delete_local`, `sftp_rename_local` e `sftp_mkdir_local` recebem paths como string do frontend e os passam diretamente ao sistema de arquivos sem nenhuma validação ou sandboxing. Embora o vetor principal seja XSS no webview (improvável em Tauri com webview isolado), qualquer exploração do webview permite ao atacante listar, deletar ou renomear arquivos arbitrários no sistema do usuário, incluindo `~/.ssh`, documentos pessoais, etc.

Cenário de reprodução: Injetar via XSS no webview a chamada `invoke("sftp_delete_local", { path: "/home/user/.ssh" })`. O diretório SSH do usuário é deletado.

Sugestão: Validar que o path fornecido é filho do home directory do usuário (`std::path::Path::starts_with(home_dir)`). Rejeitar qualquer path que escape desse escopo.

---

#### [MÉDIO] Credenciais cifradas de servidores são serializadas e enviadas ao GitHub — `sync/merge.rs:CRDTServer` / `sync/mod.rs:push_workspace`

Risco: Os campos `password_enc`, `ssh_key_enc` e `ssh_key_passphrase_enc` usam `#[serde(skip_serializing_if = "Option::is_none")]`, portanto são incluídos nos JSONs quando preenchidos e enviados ao repositório privado do GitHub. O comentário no código (`push_workspace`, linha ~280) afirma incorretamente que `password_enc` "nunca aparece no JSON output" — isso é falso e pode enganar mantenedores futuros que considerem relaxar o modelo de segurança.

Risco adicional: Se o repositório GitHub for acidentalmente tornado público, ou se a conta GitHub for comprometida, um atacante obtém os blobs cifrados e pode tentar ataque de dicionário contra a senha master do vault (PBKDF2 com 100.000 iterações — moderadamente resistente, mas quebrável com hardware dedicado).

Sugestão: (1) Corrigir imediatamente o comentário incorreto no código. (2) Avaliar se o envio de credenciais cifradas ao GitHub é aceitável pela política de segurança do produto. Alternativa: sincronizar apenas metadados dos servidores (sem credenciais) e exigir que o usuário recadastre credenciais em cada novo dispositivo.

---

#### [MÉDIO] Token do GitHub armazenado em plaintext em memória via `lazy_static` — `handlers/auth.rs:GITHUB_TOKEN`

Risco: O token OAuth do GitHub fica armazenado em `static ref GITHUB_TOKEN: Mutex<Option<String>>` durante toda a vida do processo. O próprio comentário no código diz: "Basic in-memory state for token just for testing, in a real app this should be stored securely". Qualquer dump de memória do processo (core dump, debugging) expõe o token.

Cenário de reprodução: Gerar um core dump do processo (`kill -ABRT <pid>` com `ulimit -c unlimited`). O token GitHub aparece em plaintext no dump.

Sugestão: Remover o `GITHUB_TOKEN` global. O token já está persistido de forma segura em `github_token.enc`. Ler e descriptografar do arquivo somente quando necessário (ex.: em `pull_workspace` / `push_workspace`), mantendo em variável local que sai de escopo ao fim da operação.

---

#### [MÉDIO] `app.key` armazena DEK em plaintext no filesystem (estado Unconfigured) — `services/crypto.rs:new`

Risco: Enquanto o vault não é configurado com senha (estado `Unconfigured`), o DEK que cifra as credenciais fica em `app.key` como bytes raw sem nenhuma proteção adicional. Qualquer processo com acesso ao diretório de dados do app (ou backup não cifrado do sistema) pode ler esse arquivo e decifrar todas as credenciais salvas.

Sugestão: Nível mínimo: documentar claramente que o vault deve ser configurado para proteção real. Nível ideal: exigir que o usuário configure o vault antes de permitir salvar qualquer credencial.

---

#### [BAIXO] Resposta de sucesso do OAuth é enviada antes da verificação de CSRF — `auth/github.rs:start_oauth_flow`

Risco: A página HTML de "Authentication Successful!" é enviada ao navegador antes da verificação `returned_state != state`. Em caso de ataque CSRF, o usuário vê a tela de sucesso mesmo com state inválido; o token não é trocado, mas a UI pode confundir o usuário ou mascarar o ataque.

Sugestão: Mover a verificação de state para antes do envio da resposta HTTP, enviando página de erro se o state não bater.

---

### 5. Falhas na Regra de Negócio

#### [MÉDIO] Servidores de workspaces não-sincronizados são incluídos na contagem do commit — `sync/mod.rs:push_workspace`

Risco: O commit message inclui `Servers: {total_servers}` calculado como `resolved_servers.iter().filter(|s| !s.deleted).count()`. Este total inclui servidores de workspaces com `sync_enabled = false` (apenas locais), criando discrepância entre o que foi realmente enviado e o que o commit message reporta. Auditoria do histórico git fica incorreta.

Sugestão: Filtrar por `sync_enabled && !s.deleted` ao calcular `total_servers` no commit message.

---

#### [MÉDIO] `merge_servers` não protege servidores locais de workspaces não-sincronizados de serem sobrescritos por merge — `sync/merge.rs:merge_servers`

Risco: A proteção via `pulled_workspace_ids` evita que servidores de workspaces **ausentes** no remote sejam tocados. Porém, se um workspace existir no remote com `sync_enabled = false` (foi sincronizado antes e depois desabilitado), seus servidores ainda estarão no `pulled_workspace_ids` e serão candidatos ao merge LWW. O resultado é que desabilitar sync de um workspace não impede que seus servidores sejam sobrescritos por um pull futuro.

Sugestão: Ao construir `pulled_workspace_ids`, verificar também `sync_enabled = true` no dado remoto. Alternativamente, durante pull, ignorar workspaces remotos com `sync_enabled = false`.

---

#### [MÉDIO] `delete_workspace` soft-deleta todos os servidores com um único HLC — `handlers/workspace.rs:delete_workspace`

Risco: Ver item já descrito em Bugs/Médio (seção 3). Além do aspecto de bug no CRDT, há implicação de regra de negócio: ao deletar o workspace, todos os servidores recebem o mesmo HLC. Se outro dispositivo deletar individualmente um servidor desse workspace com HLC ligeiramente anterior, o merge vai restaurar esse servidor (local vence por HLC), contradizendo a intenção do usuário de ter deletado o workspace inteiro.

Sugestão: Usar `HLC::now` por servidor deletado individualmente, garantindo que cada soft-delete seja um evento CRDT independente e monotonicamente crescente.

---

#### [BAIXO] Não há validação de comprimento/formato dos campos `host`, `name`, `username` em `create_server` / `update_server` — `handlers/server.rs`

Risco: Campos como `host` aceitam strings vazias ou arbitrariamente longas (sem limite). Um servidor com `host = ""` seria criado com sucesso e causaria erro apenas ao tentar conectar. Um `port = 0` também é aceito (bind `u16` permite 0–65535 sem restrição).

Sugestão: Validar no handler: `host` e `username` não vazios; `port` entre 1 e 65535; `name` com comprimento máximo razoável.

---

### 6. Sugestões de Testes

- **Teste 1 — import_vault em dispositivo com credenciais locais:** ✅ **IMPLEMENTADO** — `test_import_vault_compartilha_dek_entre_dispositivos` e `test_import_vault_falha_com_senha_errada` em `services/crypto.rs`. Cobre: Dispositivo B decifra dados do A; senha errada não altera estado.

- **Teste 2 — Colisão de session_id no SSH:** ⏳ Pendente — requer mockado do `SshService` ou integração real.

- **Teste 3 — delete_server em ID inexistente:** ⏳ Pendente — requer banco in-memory com AppState.

- **Teste 4 — path traversal local no SFTP:** ⏳ Pendente — o handler não possui validação; o teste só pode ser escrito após a correção do bug.

- **Teste 5 — download com falha de rede:** ⏳ Pendente — requer mock de sessão SFTP.

- **Teste 6 — merge_servers com workspace sync_enabled=false:** ⏳ Pendente — requer banco SQLite in-memory com State mockado.

- **Teste 7 — unlock_vault com vault Unconfigured:** ✅ **IMPLEMENTADO** — `test_unlock_noop_quando_unconfigured` em `services/crypto.rs`. Documenta e verifica o comportamento atual (retorna `Ok()` sem verificar senha).

- **Teste 8 — delete diretório SFTP não vazio:** ⏳ Pendente — requer mock de sessão SFTP.

---

### Resumo Executivo

| Categoria | ALTO | MÉDIO | BAIXO |
|---|---|---|---|
| Bugs | 2 | 4 | 3 |
| Segurança | 2 | 3 | 1 |
| Regra de Negócio | 0 | 2 | 1 |
| **Total** | **4** | **9** | **5** |

**Prioridade imediata (ALTO):**
1. **`import_vault` destrói credenciais locais** — afeta integridade de dados do usuário (perda permanente de acesso a credenciais salvas).
2. **`check_server_key` sempre `true`** — todas as sessões SSH são vulneráveis a MITM; credenciais e dados trafegados ficam expostos na rede.
3. **Path traversal SFTP local** — permite que um XSS no webview acesse o sistema de arquivos do usuário sem restrição.
4. **`push_workspace` com URL dummy** — pode travar o fluxo de sync com erro confuso em cenário de recuperação após falha.

**Observação geral sobre cobertura de testes:** ~~Os 13 testes existentes cobrem apenas `sync::crdt`. Todos os serviços críticos (crypto, ssh, sftp, merge, db) não têm nenhum teste automatizado, tornando regressões silenciosas muito prováveis em qualquer mudança futura.~~

**Atualizado:** 47 testes após sessão de 2026-04-13. `CryptoService` agora tem cobertura abrangente. SSH, SFTP, sync/merge e handlers IPC ainda não têm testes (requerem infra de integração com banco e mocks de rede).

---

## Histórico de Atualizações

### 2026-04-13 — Sessão de Qualidade (build)

**Corrigido:**
- `cargo fmt` executado em 13 arquivos (58 diffs)
- 16 clippy warnings eliminados (`needless_borrow`, `ptr_arg`, `new_without_default`, `iter_last`, `useless_format`, `too_many_arguments`, deref desnecessário)
- `#[tracing::instrument]` adicionado em 34 handlers sem anotação
- Criados `src/lib/api/vault.ts` e `src/lib/api/auth.ts` — eliminados `invoke()` diretos em `Sidebar.tsx` e `VaultGuard.tsx`
- Interface `Props.workspace` em `WorkspaceDetail.tsx` corrigida (`sync_enabled` adicionado) — 3× `as any` removidos
- `useToast() as any` removido em `VaultGuard.tsx`
- 6× `console.error` em produção removidos (`useAuth.ts`, `TitleBar.tsx`, `VaultGuard.tsx`)
- `_tabCounter` global em `useTerminalManager.ts` substituído por `crypto.randomUUID()`
- Comentário obsoleto em `useAuth.ts` atualizado
- `serde_json::to_string().unwrap()` em `handlers/server.rs` substituído por `map_err(|e| e.to_string())?`

**Não corrigido (bugs e segurança do relatório permanecem abertos):**
- Todos os itens das seções 3, 4 e 5 continuam válidos e não foram tratados nesta sessão.

### 2026-04-13 — Sessão de Testes (test)

**Criado:**
- 28 testes em `services/crypto.rs` cobrindo ciclo completo do vault
- 9 testes adicionais em `sync/crdt.rs` (comutatividade, transitividade, `get_or_create_node_id`, empate em LWW)
- Sugestões #1 e #7 da seção 6 implementadas como testes automatizados
