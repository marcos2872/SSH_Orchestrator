# Construí um cliente SSH com sync entre máquinas: suas credenciais ficam cifradas no seu próprio GitHub

Uso múltiplos notebooks no dia a dia e nunca encontrei um cliente SSH que sincronizasse configurações sem exigir que eu confiasse num servidor de terceiros. Construí o **SSH Orchestrator** para resolver isso — cliente `SSH`/`SFTP` nativo com vault zero-knowledge, sync via repositório GitHub privado e resolução automática de conflitos.

![Tela inicial do SSH Orchestrator com workspaces na sidebar e botão de sincronização](https://raw.githubusercontent.com/marcos2872/SSH_Orchestrator/refs/heads/main/app-images/2.png)

---

## O problema

1. **Sync obriga a confiar em infraestrutura de terceiros**
   Clientes comerciais que sincronizam configurações armazenam ou intermediam credenciais em servidores próprios. Em ambientes com restrições de segurança, isso não é negociável.

2. **Repositório `git` com `~/.ssh/config` não escala para múltiplos dispositivos**
   Funciona bem com um único dispositivo. Com dois ou mais editando em paralelo, o merge é manual — e deleções feitas num dispositivo não propagam para o outro.

3. **Clientes baseados em Electron pesam entre 150 MB e 300 MB**
   Terminus, Tabby e similares são funcionais. Mas empacotam um Chromium inteiro para o que é, na prática, um terminal com gerenciamento de conexões.

4. **Nenhuma aba de shell local integrada**
   A maioria dos clientes força a alternar para outro programa quando a tarefa não precisa de conexão remota.

---

## O que resolve

- **[Tauri v2](https://tauri.app/)** — framework desktop com `WebView` nativa do SO e backend em Rust; sem Chromium empacotado.
- **[russh](https://github.com/warp-tech/russh)** — implementação assíncrona de `SSH2` em Rust puro, autenticação por senha e chave `PEM`.
- **[ring](https://github.com/briansmith/ring)** — criptografia `AES-256-GCM` e `PBKDF2-HMAC-SHA256` em Rust.
- **[git2](https://github.com/rust-lang/git2-rs)** — operações `git` nativas pelo backend: clone, pull, commit, push.
- **[xterm.js](https://xtermjs.org/)** — emulador de terminal com suporte a cores 256/truecolor e redimensionamento de `PTY`.
- **[portable-pty](https://github.com/wez/wezterm/tree/main/pty)** — shell local nativo sem `SSH`, cross-platform.

---

## Como resolve

### O frontend nunca vê uma credencial

Quando o app abre uma conexão `SSH`, o processo nativo em Rust busca a credencial no banco, descriptografa em memória e autêntica — tudo sem passar pelo frontend. O React recebe apenas um booleano dizendo se existe credencial salva. O valor em si nunca cruza a ponte `IPC`.

A proteção usa duas camadas de chave. Uma chave de dados (`DEK`) cifra as credenciais com `AES-256-GCM`. A própria `DEK` fica em disco cifrada por uma chave derivada da master password via `PBKDF2` com 100.000 iterações. Sem a master password digitada em tempo de execução, não há caminho para as credenciais — nem no banco local, nem no repositório GitHub.

### O repositório GitHub é apenas storage; o conflito é resolvido localmente

O que vai para o repositório é ciphertext. Acesso ao repositório sem a master password não revela nada útil.

A resolução de conflitos usa `CRDT` com `LWW-Register` e `HLC` (Hybrid Logical Clock). Cada registro carrega um timestamp com três componentes: instante em milissegundos, contador por dispositivo e identificador de nó. Quando dois dispositivos editam o mesmo servidor em paralelo, vence o registro com timestamp maior. A decisão é determinística e local — sem coordenação central, sem round-trip para servidor.

Deleções funcionam via soft-delete: remover um servidor num dispositivo propaga a deleção para os demais no próximo sync. Dois dispositivos offline por dias convergem corretamente na próxima sincronização.

### O instalador tem cerca de 20 MB

Tauri v2 usa a `WebView` nativa do sistema — WebKitGTK no Linux, WKWebView no macOS, WebView2 no Windows. O resultado é cerca de 20 MB de instalador contra os 150 a 300 MB de clientes Electron. O custo real é variação de comportamento de renderização entre plataformas; alguns ajustes de CSS por SO são necessários.

---

## O que entrega

| Funcionalidade | Comportamento |
|---|---|
| Terminal `SSH` | Múltiplas abas, split-pane horizontal e vertical, 6 temas |
| Terminal local | Shell nativo sem conexão remota, mesmos temas das abas `SSH` |
| `SFTP` dual-pane | Painel local/remoto com upload e download recursivo, fila de progresso em tempo real |
| Workspaces | Agrupamento de servidores; cada workspace pode ser local ou sincronizado |
| Sync GitHub | Push e pull com `CRDT`; deleções propagam entre dispositivos |
| Vault | `AES-256-GCM`; master password nunca armazenada em nenhuma forma |
| Autenticação | Senha ou chave `PEM` com passphrase; `TOFU` para verificação de host key |

![Workspace com terminal local e servidor SSH listado](https://raw.githubusercontent.com/marcos2872/SSH_Orchestrator/refs/heads/main/app-images/3.png)

![Sessão SSH ativa com terminal funcional](https://raw.githubusercontent.com/marcos2872/SSH_Orchestrator/refs/heads/main/app-images/4.png)

No primeiro uso, o app exige configuração do vault antes de renderizar qualquer coisa. Ao conectar com GitHub, se um repositório de sync já existir, as credenciais são importadas com re-cifragem automática para o novo dispositivo — sem transmitir a master password. Cada workspace tem controle independente de sync: servidores pessoais sincronizados, servidores de cliente estritamente locais.

---

## Considerações finais

Usar GitHub como storage em vez de um servidor próprio elimina infraestrutura a manter e deixa o histórico auditável. O modelo `CRDT` com `HLC` garante convergência correta sem coordenação central.

O que o app não resolve: sync em tempo real entre sessões ativas simultâneas. Se dois dispositivos estiverem abertos ao mesmo tempo, cada um só vê as mudanças do outro no próximo pull manual. Para configuração de servidores, esse trade-off é aceitável.

Repositório: [github.com/marcos2872/SSH_Orchestrator](https://github.com/marcos2872/SSH_Orchestrator).