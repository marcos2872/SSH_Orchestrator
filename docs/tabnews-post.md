# Construí um cliente SSH em Tauri/Rust com CRDT e vault zero-knowledge — 20 MB, sem servidor próprio

Trabalho com dois notebooks e perdi a conta de quantas vezes precisei recriar servidores SSH do zero porque esqueci de copiar o `~/.ssh/config`. Tentei as alternativas disponíveis, nenhuma resolveu do jeito que eu queria. Então fiz o que qualquer desenvolvedor racional faria: decidi construir o meu. O resultado é o **SSH Orchestrator** — ainda está na versão 0.0.8, alpha pesado, não recomendo para produção sem testes na sua máquina.

![Tela inicial com workspaces na sidebar e terminal SSH ativo](https://raw.githubusercontent.com/marcos2872/SSH_Orchestrator/refs/heads/main/app-images/2.png)

---

## O problema, especificado

**1. Sync com terceiros ou sem sync nenhum.**
Clientes comerciais que sincronizam configurações — Termius, por exemplo — guardam ou intermediam credenciais nos servidores deles. Em ambientes com política de segurança mais restrita, isso fecha a porta.

**2. Git com `~/.ssh/config` não sobrevive a edição simultânea.**
Funciona bem com um dispositivo. Com dois editando em paralelo, o merge é manual. Pior: deleções feitas num dispositivo simplesmente não chegam no outro — não existe mecanismo de propagação.

**3. Clientes Electron pesam entre 150 MB e 300 MB.**
Terminus, Tabby e similares empacotam um Chromium inteiro para o que é, na prática, um terminal com gerenciamento de conexões. Para uso diário isso vira ruído.

**4. Nenhuma aba de shell local integrada.**
A maioria dos clientes força a troca de programa quando a tarefa não precisa de conexão remota.

---

## O que tentei antes

A opção mais próxima do que eu queria era manter um repositório Git privado com as configs exportadas manualmente e um script de sync. Funcionou por algumas semanas. Quebrou quando editei servidores no notebook de casa enquanto o do trabalho estava desligado e, ao sincronizar, o script de merge sobrescreveu as mudanças mais recentes.

Olhei para ferramentas de sincronização baseadas em CRDT — o conceito era exatamente o que eu precisava para resolver o problema de edição concorrente. Mas não existia nada que resolvesse o caso específico de configurações SSH com credenciais criptografadas e controle granular por workspace. O caminho foi construir.

---

## As três decisões centrais

### Tauri em vez de Electron

`Tauri v2` usa a `WebView` nativa do sistema operacional — WebKitGTK no Linux, WKWebView no macOS, WebView2 no Windows. O frontend é React com `xterm.js`; o backend é Rust com `Tokio`. O resultado concreto: o instalador tem cerca de 20 MB. O custo real é variação de comportamento de renderização entre plataformas — alguns ajustes de CSS por SO são necessários, e o suporte a certas APIs de WebView não é uniforme. Para terminal SSH, onde o que importa é latência de I/O e não renderização rica, esse trade-off é aceitável.

| | SSH Orchestrator | Tabby / Terminus (Electron) |
|---|---|---|
| Tamanho do instalador | ~20 MB | 150–300 MB |
| Runtime empacotado | WebView nativa do SO | Chromium completo |
| Backend | Rust + Tokio | Node.js |
| SSH engine | `russh` (Rust puro) | `ssh2` (bindings Node) |

### Vault zero-knowledge

O modelo de ameaça que me interessava: mesmo que alguém acesse o banco local ou o repositório GitHub, as credenciais precisam ser inúteis sem a master password digitada em runtime.

A solução usa dois níveis de chave. Uma chave de dados (`DEK`) cifra cada credencial individualmente com `AES-256-GCM`, usando um nonce aleatório por operação — então dois servidores com a mesma senha produzem ciphertexts diferentes. A própria `DEK` fica armazenada cifrada por uma chave derivada da master password via `PBKDF2-HMAC-SHA256` com 100.000 iterações e salt de 16 bytes. A master password nunca é armazenada em nenhuma forma — nem em plaintext, nem como hash.

O frontend nunca recebe a credencial. Quando o app abre uma sessão `SSH`, o processo Rust busca o ciphertext no banco, descriptografa em memória e autentica — o React recebe apenas `has_saved_password: bool`. Se alguém clonar o repositório GitHub sem a master password, o que encontra é ciphertext sem utilidade.

### CRDT para sync sem coordenação central

O repositório GitHub privado é só storage. A resolução de conflitos acontece localmente, sem round-trip para servidor.

O mecanismo é um `LWW-Register` (Last-Write-Wins) com `HLC` (Hybrid Logical Clock). Cada registro carrega três componentes no seu timestamp: instante em milissegundos, contador lógico por dispositivo e identificador de nó de 8 caracteres. Quando dois dispositivos editam o mesmo servidor em paralelo, o merge compara esses timestamps e mantém o registro com timestamp maior — a decisão é determinística e produz o mesmo resultado em qualquer ordem de chegada.

Deleções propagam via soft-delete: remover um servidor marca o registro como `deleted = true` com o HLC do momento. Dois dispositivos offline por dias convergem corretamente na próxima sincronização — sem `git rebase`, sem resolução manual de conflito.

---

## O que o app entrega hoje

| Funcionalidade | Comportamento |
|---|---|
| Terminal `SSH` | Múltiplas abas, split-pane horizontal e vertical, 6 temas |
| Terminal local | Shell nativo via PTY sem conexão remota, mesmos temas |
| `SFTP` dual-pane | Painel local/remoto, upload e download recursivo, fila de progresso em tempo real |
| Workspaces | Agrupamento de servidores; cada workspace pode ser local ou sincronizado individualmente |
| Sync GitHub | Push/pull com CRDT; deleções propagam entre dispositivos |
| Vault | `AES-256-GCM`; master password nunca armazenada em nenhuma forma |
| Autenticação `SSH` | Senha ou chave `PEM` com passphrase; `TOFU` para verificação de host key |

![Sessão SSH ativa com terminal e split-pane](https://raw.githubusercontent.com/marcos2872/SSH_Orchestrator/refs/heads/main/app-images/4.png)

No primeiro uso, o app exige configuração do vault antes de renderizar qualquer coisa. Ao conectar com GitHub, se um repositório de sync já existir, as credenciais são importadas com re-cifragem automática para o novo dispositivo — sem transmitir a master password pela rede.

Para rodar localmente:

```bash
# Pré-requisitos: Rust 1.77+, Node.js, pnpm
git clone https://github.com/marcos2872/SSH_Orchestrator.git
cd SSH_Orchestrator
pnpm install
cp .env.example .env
# Edite .env com GH_CLIENT_ID e GH_CLIENT_SECRET do seu OAuth App no GitHub
pnpm tauri dev
```

> Para criar o OAuth App: GitHub Settings → Developer Settings → OAuth Apps → New OAuth App. A callback URL deve ser `http://localhost` — o app usa uma porta dinâmica.

---

## O que ainda não resolve

O sync não é em tempo real. Se dois dispositivos estiverem abertos simultaneamente, cada um só enxerga as mudanças do outro no próximo pull manual. Para configuração de servidores, esse trade-off foi intencional — sincronização por push/pull explícito é mais previsível do que sync automático em background quando credenciais estão envolvidas.

Integração com `ssh-agent` ainda não existe. Hoje a autenticação por chave `PEM` é gerenciada pelo vault interno. Isso é suficiente para a maioria dos casos, mas quem depende de `ssh-agent` para forwarding de chaves vai sentir falta.

A versão atual é 0.0.8. Testei principalmente em Linux; macOS e Windows devem funcionar — Tauri é cross-platform — mas não testei em profundidade.

Repositório: [github.com/marcos2872/SSH_Orchestrator](https://github.com/marcos2872/SSH_Orchestrator)
