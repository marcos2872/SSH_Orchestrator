# Changelog

Todas as mudanças notáveis do SSH Orchestrator serão documentadas neste arquivo.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o
versionamento segue [Semantic Versioning](https://semver.org/lang/pt-BR/).

> Para lançar uma nova versão: mova as mudanças de `[Unreleased]` para uma nova
> seção `## [X.Y.Z] - AAAA-MM-DD` e crie a tag `vX.Y.Z` (ver workflow `.github/workflows/release.yml`).

## [0.1.0] - 2026-09-26

### Adicionado

- **Terminal SSH** com tabs, split-pane horizontal/vertical e 6 temas (xterm.js)
- **SFTP Dual-Pane** — gerenciador local ↔ remoto com seleção múltipla, transferência recursiva e fila com progresso
- **Terminal Local** — shell nativo em aba dedicada via `portable-pty`
- **Vault Zero-Knowledge** — AES-256-GCM + PBKDF2, com desbloqueio automático opcional (todas as vezes, 1 semana ou 1 mês via keychain do SO)
- **Sync via GitHub** — workspaces e servidores entre dispositivos via repositório privado, merge CRDT (LWW-Register + HLC)
- **Autenticação SSH flexível** — senha ou chave PEM com passphrase, verificação TOFU de host-key
- **Teclas de atalho configuráveis** com detecção de conflitos
- **Verificação de atualizações** — versão dinâmica e botão de nova release nas Configurações
- **Alças de redimensionamento** na janela frameless e UI kit padronizado (Lucide, PT-BR)
