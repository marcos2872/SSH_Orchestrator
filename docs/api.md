# Comandos IPC — Referência da API

> O frontend se comunica com o backend exclusivamente via `invoke<T>()` do Tauri.
> Toda resposta de sucesso retorna `T`; erros retornam `string`.
> Dados em stream (saída SSH, PTY) chegam via `listen()` — detalhados na seção de Eventos.

---

## Workspaces

| Comando | Parâmetros | Retorno | Descrição |
|---|---|---|---|
| `get_workspaces` | — | `Workspace[]` | Lista workspaces não deletados, ordenados por nome |
| `create_workspace` | `name: string, color: string` | `Workspace` | Cria workspace (sync_enabled=false por padrão) |
| `update_workspace` | `id, name, color, sync_enabled?` | `void` | Atualiza nome, cor e flag de sincronização |
| `delete_workspace` | `id: string` | `void` | Soft-delete do workspace e de todos os seus servidores |

### Modelo retornado: `Workspace`

```typescript
interface Workspace {
  id: string;           // UUID v4
  name: string;
  sync_enabled: boolean;
  local_only: boolean;
  color: string;        // Hex, ex: "#0a84ff"
  updated_at: string;   // ISO 8601
  hlc: string;          // "timestamp_ms:counter:node_id"
  deleted: boolean;
}
```

---

## Servidores

| Comando | Parâmetros | Retorno | Descrição |
|---|---|---|---|
| `get_servers` | `workspace_id: string` | `Server[]` | Lista servidores não deletados de um workspace |
| `create_server` | ver abaixo | `Server` | Cria servidor com credenciais cifradas |
| `update_server` | ver abaixo | `void` | Atualiza metadados e rotaciona credenciais |
| `delete_server` | `id: string` | `void` | Soft-delete do servidor |

### Parâmetros de `create_server` e `update_server`

```typescript
{
  workspace_id?: string;      // Apenas create_server
  id?: string;                // Apenas update_server
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;          // Nunca armazenado em plaintext
  save_password: boolean;     // false = limpa credencial salva
  ssh_key?: string;           // PEM da chave privada
  save_ssh_key: boolean;
  ssh_key_passphrase?: string;
  save_ssh_key_passphrase: boolean;
  auth_method: "password" | "ssh_key";
}
```

### Modelo retornado: `Server`

```typescript
interface Server {
  id: string;                      // UUID v4
  workspace_id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  tags: string[];
  folder_color: string | null;
  has_saved_password: boolean;     // Nunca expõe o valor real
  has_saved_ssh_key: boolean;
  has_saved_ssh_key_passphrase: boolean;
  auth_method: "password" | "ssh_key";
  hlc: string;
  deleted: boolean;
}
```

> ⚠️ O frontend **nunca recebe** `password_enc`, `ssh_key_enc` ou `ssh_key_passphrase_enc`. Apenas os booleanos `has_saved_*` indicam se a credencial está salva.

---

## SSH

| Comando | Parâmetros | Retorno | Descrição |
|---|---|---|---|
| `ssh_connect` | ver abaixo | `string` (session_id) | Conecta ao servidor SSH, aloca PTY |
| `ssh_write` | `session_id, data: string` | `void` | Envia input ao terminal remoto |
| `ssh_resize` | `session_id, cols, rows` | `void` | Notifica resize do PTY remoto |
| `ssh_disconnect` | `session_id: string` | `void` | Encerra sessão SSH |

### Parâmetros de `ssh_connect`

```typescript
{
  server_id: string;
  password?: string;
  ssh_key?: string;              // PEM inline (opcional)
  ssh_key_passphrase?: string;
  session_id: string;            // UUID gerado pelo frontend
  cols?: number;                 // padrão: 80
  rows?: number;                 // padrão: 24
}
```

### Prioridade de autenticação SSH

1. `ssh_key` inline fornecido na chamada + `ssh_key_passphrase`
2. Chave SSH salva no banco (descriptografada pelo vault)
3. `password` fornecido na chamada
4. Senha salva no banco (descriptografada pelo vault)

---

## SFTP

| Comando | Parâmetros | Retorno | Descrição |
|---|---|---|---|
| `sftp_open_session` | `session_id` (SSH) | `string` (sftp_id) | Abre sessão SFTP sobre SSH existente |
| `sftp_direct_connect` | `server_id, password?` | `string` (sftp_id) | Conecta via SSH+SFTP sem abrir shell |
| `sftp_list_dir` | `session_id, path` | `SftpEntry[]` | Lista diretório remoto |
| `sftp_list_local` | `path: string` | `LocalEntry[]` | Lista diretório local |
| `sftp_workdir` | `session_id` | `string` | Home remota (realpath ".") |
| `sftp_home_dir` | — | `string` | $HOME local |
| `sftp_upload` | `session_id, local_path, remote_path` | `void` | Upload com progresso |
| `sftp_download` | `session_id, remote_path, local_path` | `void` | Download com progresso |
| `sftp_upload_recursive` | `session_id, local_path, remote_path` | `void` | Upload recursivo de diretório |
| `sftp_download_recursive` | `session_id, remote_path, local_path` | `void` | Download recursivo de diretório |
| `sftp_delete` | `session_id, path` | `void` | Remove arquivo/diretório remoto |
| `sftp_rename` | `session_id, from, to` | `void` | Renomeia no servidor remoto |
| `sftp_mkdir` | `session_id, path` | `void` | Cria diretório remoto |
| `sftp_close_session` | `session_id` | `void` | Encerra sessão SFTP |
| `sftp_delete_local` | `path: string` | `void` | Remove arquivo/diretório local |
| `sftp_rename_local` | `from, to` | `void` | Renomeia localmente |
| `sftp_mkdir_local` | `path: string` | `void` | Cria diretório local |

---

## PTY Local

| Comando | Parâmetros | Retorno | Descrição |
|---|---|---|---|
| `pty_spawn` | `session_id, cols?, rows?, shell?` | `string` (session_id) | Spawna shell nativo |
| `pty_write` | `session_id, data: string` | `void` | Envia bytes (base64) ao stdin |
| `pty_resize` | `session_id, cols, rows` | `void` | Redimensiona PTY local |
| `pty_kill` | `session_id` | `void` | Mata o processo e libera sessão |

> `data` em `pty_write` deve ser codificado em **base64** (UTF-8 bytes do input do usuário).

---

## Vault

| Comando | Parâmetros | Retorno | Descrição |
|---|---|---|---|
| `is_vault_configured` | — | `boolean` | True se vault.json existe |
| `is_vault_locked` | — | `boolean` | True se vault está Locked |
| `setup_vault` | `password: string` | `void` | Configura vault pela primeira vez (mín. 8 chars) |
| `unlock_vault` | `password: string` | `void` | Desbloqueia vault com master password |
| `check_synced_vault` | — | `boolean` | Verifica se vault_sync.json existe no repo |
| `import_synced_vault` | `password: string` | `void` | Importa e desbloqueia vault sincronizado |
| `get_vault_last_access` | — | `string \| null` | ISO 8601 do último unlock (ou null) |

---

## Autenticação GitHub

| Comando | Parâmetros | Retorno | Descrição |
|---|---|---|---|
| `github_login` | — | `GitHubUser` | Inicia fluxo OAuth, aguarda callback, salva token cifrado |
| `get_current_user` | — | `GitHubUser \| null` | Retorna usuário autenticado (a partir do token salvo) |
| `github_logout` | — | `void` | Remove token cifrado do disco |

### Modelo: `GitHubUser`

```typescript
interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
  email: string | null;
  html_url: string;
}
```

---

## Sincronização

| Comando | Parâmetros | Retorno | Descrição |
|---|---|---|---|
| `pull_workspace` | `provided_token?: string` | `void` | Clona/atualiza repo, merge LWW no SQLite |
| `push_workspace` | `provided_token?: string` | `void` | Pull + merge + serializa JSONs + commit + push |

> Apenas um sync pode ocorrer por vez — `sync_lock` retorna erro `"Sincronização já em andamento"` se tentar concorrência.

---

## Eventos Tauri (listen)

| Evento | Payload | Descrição |
|---|---|---|
| `ssh://data/{session_id}` | `string` (bytes do terminal) | Output do terminal remoto |
| `pty://data/{session_id}` | `string` (base64) | Output do PTY local |
| `pty://close/{session_id}` | — | Shell local encerrou |
| `sftp://progress` | `{ bytes_transferred, total_bytes, file_name }` | Progresso de transferência |
| `sync://progress` | `{ step: string, detail: string }` | Progresso da sincronização |

### Passos emitidos por `sync://progress`

| `step` | `detail` exemplo |
|---|---|
| `connect` | `"Conectando ao GitHub…"` |
| `fetch` | `"Baixando dados do repositório…"` |
| `merge` | `"Mesclando dados…"` |
| `serialize` | `"Preparando dados para envio…"` |
| `push` | `"Enviando dados para o GitHub…"` |
| `done` | `"Sincronização concluída!"` |
