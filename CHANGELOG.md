# Changelog

Todas as mudanças notáveis do SSH Orchestrator serão documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o
versionamento segue [Semantic Versioning](https://semver.org/lang/pt-BR/).

> Para lançar uma nova versão: mova as mudanças de `[Unreleased]` para uma nova
> seção `## [X.Y.Z] - AAAA-MM-DD` e crie a tag `vX.Y.Z` (ver workflow `.github/workflows/release.yml`).

## [0.1.5] - 2026-08-10

### Alterado

- **Contraste da interface**: textos, ícones e estados vazios com melhor legibilidade em toda a UI
  - Sidebar: ícones de seção e rótulos mais claros, estado "Nenhum workspace" mais visível
  - Telas de estado vazio e botões da TitleBar (tema, fechar tudo) com cores mais claras
  - VaultGuard: labels e placeholders dos campos de senha mais visíveis
  - SFTP: breadcrumbs, tamanhos de arquivo, "Pasta vazia" e rodapé de drag & drop com contraste maior
  - Fila de transferências: botão cancelar mais visível
  - Terminal: mensagem do modal de credenciais mais legível
  - Dropdown de email da TitleBar mais legível
  - Tela de detalhes do workspace: textos de status mais claros
- **Tela de detalhes do workspace**: botões de ação do servidor redesenhados — layout em grid de 2 colunas com ícone grande e rótulo (SSH / SFTP) em vez de botão único "Connect"
- **Tab bar do terminal**: indicador de aba inativa mais visível e botão fechar sempre visível (antes só aparecia no hover), com cor adaptada ao estado da aba

### Internos

- `Cargo.lock` sincronizado com a versão do pacote (0.1.4)

## [0.1.4] - 2026-05-11

### Corrigido

- Autenticação SSH com chaves RSA
- Contraste dos campos de senha e passphrase nos modais

## [0.1.0] - 2026-04-16

### Adicionado

- **Teclas de atalho configuráveis**: nova seção "Teclas de Atalho" no modal de Configurações
  - Edição por clique + combinação de teclas, com suporte a Ctrl, Shift, Alt e Super
  - Detecção automática de conflitos entre atalhos
  - Botão "Restaurar padrões" e persistência em SQLite via IPC

### Corrigido

- Captura da tecla Super no Linux/X11 (reportada como `"Super"` em vez de `"Meta"`)
- Atalho "Nova aba" (Ctrl+T) conectado corretamente

### Internos

- Nova tabela `settings` no SQLite com handlers `get_setting` / `set_setting`
- Bundle AppImage removido dos targets de build

## [0.0.8] - 2026-04-14

### Segurança

- **SSH TOFU host-key verification**: fingerprint SHA-256 registrada na primeira conexão e conexões rejeitadas se a chave mudar (anti-MITM)
- **OAuth timeout**: login GitHub não trava mais o app se o browser for cancelado
- **Sync concorrente**: push faz pull → merge → serialize até 3× antes de recorrer ao force-push

### Corrigido

- **Tombstones propagados**: deletar servidor/workspace agora propaga a deleção via CRDT
- Senha mínima de 8 caracteres no setup do Vault
- Token GitHub re-cifrado corretamente após importar vault de outro dispositivo
- SFTP delete recursivo de pastas não-vazias
- Validação de workspace antes de inserir servidor órfão (prevenção de FK dangling)
- Erro descritivo se o repo de sync sumir entre operações

### Internos

- `auth_method` validado como `password` | `ssh_key` no backend
- `update_server` retorna erro quando o servidor não existe
- Token GitHub revogado no servidor ao fazer logout

## [0.0.7] - 2026-04-13

### Adicionado

- **SFTP — transferência múltipla e de pastas**:
  - Seleção múltipla (Click, Ctrl+Click, Shift+Click) nos dois painéis
  - Upload/download recursivo de pastas com subpastas
  - Fila sequencial com painel colapsável: progresso por item, status visual, cancelar e limpar concluídos
- **Sidebar com conexões ativas**: colapso automático ao abrir aba, bloqueio de troca de workspace com conexões ativas e indicadores visuais

### Corrigido

- Botões Renomear/Excluir do menu de contexto SFTP sem resposta (conflito de stacking context CSS com backdrop-filter)
- Guard DashMap liberado antes do loop de I/O em upload/download (lock síncrono sobre await points)

### Internos

- `cargo fmt` + 16 clippy warnings corrigidos
- `#[tracing::instrument]` em todos os 34 handlers
- 47 testes no total (28 CryptoService + 9 HLC/LWW + demais)

## [0.0.6] - 2026-03-31

### Adicionado

- Campo `auth_method` no banco: método de autenticação preferido (senha ou chave SSH) persistido por servidor

### Corrigido

- Modal de conexão com chave SSH sem credencial salva agora pede PEM + passphrase corretamente
- Modal cortado no topo do app (clipping context do `#root`); modais agora renderizam via `ReactDOM.createPortal()` em `document.body`

## [0.0.5] - 2026-03-31

### Adicionado

- Nova identidade visual: logo com chevron + grafo de rede em todos os formatos (`.icns`, `.ico`, PNGs) e na TitleBar
- Tela de estado vazio com a nova logo

### Corrigido

- Favicon quebrado (`/vite.svg` → `/icon.png`)
- Título da página (`Tauri + React + Typescript` → `SSH Orchestrator`)

## [0.0.4] - 2026-03-31

### Corrigido

- Ícone na taskbar do KDE Wayland: `identifier` alterado para `ssh-orchestrator`, alinhando `app_id` com o `StartupWMClass` do `.desktop`

## [0.0.3] - 2026-03-31

### Adicionado

- Novo ícone do app (`>_` + grafo de nós) na janela, taskbar e instaladores
- `set_icon()` explícito no setup Rust via `include_image!`

## [0.0.2] - 2026-03-31

### Adicionado

- **Redesign Apple HIG dark mode**: glassmorphism, paleta sistêmica Apple, tipografia SF Pro, inputs e modais arredondados
- Janela sem decorações com transparência real (`border-radius: 12px` no `#root`)
- Paleta ANSI Apple no terminal (fundo `#000000`, cursor `#0a84ff`)
- Suporte a autenticação SSH com chaves privadas

## [0.0.1] - 2026-03-23

- Primeira release
