# Criei um cliente SSH com sync entre dispositivos onde seus dados nunca saem do seu controle

Trabalho com múltiplos notebooks e servidores de cliente, e a única forma que encontrei de manter configurações SSH sincronizadas era aceitar que um serviço de terceiros guardaria minhas credenciais — ou fazer merge manual de arquivos divergidos toda semana. Nenhuma das opções funcionava. Construí o **SSH Orchestrator**: um cliente SSH/SFTP nativo com sync via repositório GitHub privado e credenciais protegidas por vault zero-knowledge.

---

## O problema

1. **Credenciais sempre dependentes de um serviço externo**
   Clientes SSH comerciais que sincronizam configurações armazenam as credenciais em servidores próprios. Para ambientes com restrições de segurança, isso simplesmente não é uma opção.

2. **Sync manual sem resolução de conflito**
   Manter um repositório privado com o arquivo de configuração SSH funciona até dois dispositivos divergirem ao mesmo tempo — a partir daí, o merge é manual e propenso a perda de dados.

3. **Clientes pesados demais para o que fazem**
   Ferramentas como Terminus e Tabby são funcionais, mas empacotam um navegador inteiro. A instalação fica entre 150 MB e 300 MB para o que é, na essência, um terminal com gerenciamento de conexões.

4. **Sem terminal local integrado**
   A maioria dos clientes SSH não oferece uma aba de shell local. Tarefas que não precisam de conexão remota exigem alternar para outro programa.

---

## O que resolve

- **[Tauri v2](https://tauri.app/)** — framework desktop que usa a WebView nativa do sistema operacional; backend em Rust sem Chromium empacotado.
- **[russh](https://github.com/warp-tech/russh)** — implementação assíncrona de `SSH2` em Rust puro, com autenticação por senha e chave `PEM`.
- **[ring](https://github.com/briansmith/ring)** — criptografia `AES-256-GCM` e `PBKDF2-HMAC-SHA256` em Rust.
- **[git2](https://github.com/rust-lang/git2-rs)** — operações `git` (clone, pull, commit, push) executadas diretamente pelo backend nativo.
- **[xterm.js](https://xtermjs.org/)** — emulador de terminal no frontend com suporte a cores 256/truecolor e redimensionamento dinâmico de `PTY`.
- **[portable-pty](https://github.com/wez/wezterm/tree/main/pty)** — spawn de shell local nativo cross-platform, sem conexão `SSH`.

---

## Como resolve

### As credenciais nunca saem do processo nativo

O frontend nunca vê uma senha, uma chave SSH ou uma passphrase. O que o React recebe é um booleano indicando se existe uma credencial salva — o valor real fica no processo Rust e só é descriptografado no momento exato da conexão.

Isso é possível porque as credenciais são cifradas com `AES-256-GCM` usando uma chave de dados (DEK) que nunca trafega pela ponte IPC. A DEK em si fica em disco cifrada com uma chave derivada da master password do usuário via `PBKDF2` com 100.000 iterações. Sem a master password digitada em tempo de execução, não há como recuperar nada — nem do banco local, nem do repositório GitHub.

### O sync funciona sem servidor próprio e sem conflito manual

O repositório GitHub armazena apenas ciphertext. Quem tem acesso ao repositório vê a estrutura das entradas, mas não as credenciais — o conteúdo é ilegível sem a master password.

A resolução de conflitos usa `CRDT` com `LWW-Register` e `HLC` (Hybrid Logical Clock). Cada registro carrega um timestamp vetorial com três componentes: o instante em milissegundos, um contador por dispositivo e um identificador único de nó. Quando dois dispositivos editam o mesmo servidor simultaneamente, o registro com o timestamp maior vence — a decisão é determinística, local, e não exige comunicação extra. Deleções propagam via soft-delete: remover um servidor num dispositivo remove no outro no próximo sync.

### O binário final tem cerca de 20 MB

Tauri v2 usa a WebView nativa do sistema operacional em vez de empacotar o Chromium. O resultado é um instalador de cerca de 20 MB contra os 150 a 300 MB de clientes baseados em Electron. O custo é que o comportamento de renderização varia entre plataformas — WebKitGTK no Linux, WKWebView no macOS, WebView2 no Windows — e alguns ajustes de CSS são necessários por sistema.

---

## O que entrega

| Funcionalidade | Comportamento |
|---|---|
| Terminal SSH | Múltiplas abas independentes, split-pane horizontal e vertical, 6 temas de cor |
| Terminal local | Shell nativo do sistema sem conexão remota, com os mesmos temas das abas SSH |
| Gerenciador de arquivos SFTP | Painel duplo local/remoto com upload e download recursivo de diretórios e fila de progresso em tempo real |
| Workspaces | Agrupamento de servidores com cor personalizada; cada workspace pode ser local ou sincronizado |
| Sync com GitHub | Push e pull com resolução automática de conflito via CRDT; deleções se propagam entre dispositivos |
| Vault zero-knowledge | Credenciais cifradas por AES-256-GCM; master password nunca armazenada em nenhuma forma |
| Autenticação SSH | Senha ou chave PEM com passphrase; verificação de host key `TOFU` no primeiro acesso |

Na prática: ao abrir o app pela primeira vez, a tela de vault bloqueia qualquer interação até a master password ser definida. Depois disso, o login com GitHub detecta automaticamente se existe um repositório de sync — se existir, as credenciais são importadas com re-cifragem transparente para o novo dispositivo. Cada workspace tem controle independente de sync, então é possível manter servidores pessoais sincronizados e servidores de cliente estritamente locais.

---

## Considerações finais

A decisão de não usar um servidor de sync próprio foi intencional. Repositório GitHub privado como object store elimina a necessidade de infraestrutura, reduz a superfície de ataque e deixa o histórico auditável. O modelo `CRDT` garante que o sync seja correto sem exigir coordenação central — dois dispositivos offline por dias convergem corretamente na próxima vez que estiverem online ao mesmo tempo.

O que o app não resolve: sync em tempo real entre sessões ativas simultâneas. Se dois dispositivos estiverem abertos ao mesmo tempo e um adicionar um servidor, o outro só verá a mudança no próximo pull manual. Para o caso de uso de configuração de servidores, isso é aceitável.

Repositório: [github.com/marcos2872/SSH_Orchestrator](https://github.com/marcos2872/SSH_Orchestrator).