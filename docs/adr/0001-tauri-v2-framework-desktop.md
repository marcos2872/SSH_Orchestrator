# 0001 — Tauri v2 como Framework Desktop

## Status

aceito

## Contexto

O projeto precisa de uma aplicação desktop nativa cross-platform (Linux, macOS, Windows) com:
- Emulador de terminal de alta performance
- Acesso ao sistema de arquivos local
- Operações de rede (SSH, SFTP, HTTPS)
- Footprint mínimo (bundle pequeno, baixo consumo de memória)
- UI moderna com React

Alternativas consideradas:
- **Electron**: bundle ~150 MB, alto consumo de RAM, IPC menos seguro por padrão
- **Flutter Desktop**: ecossistema frontend menos maduro, sem suporte nativo a xterm.js
- **Qt/C++**: sem React, curva de aprendizado alta para o time
- **Tauri v1**: API de comandos menos ergonômica, sem suporte a multi-window estável

## Decisão

Adotamos **Tauri v2** com backend Rust + Tokio e frontend React 19 via WebView do sistema operacional. A comunicação entre as camadas usa o protocolo IPC do Tauri (`invoke` e `emit`).

## Consequências

- (+) Bundle ~20 MB vs ~150 MB do Electron — distribuição e atualizações mais rápidas
- (+) Backend Rust com acesso nativo ao sistema, sem overhead de Node.js
- (+) Sandbox de segurança nativo do Tauri v2 — capabilities declaradas em JSON
- (+) `DashMap` e Tokio permitem multiplexação eficiente de sessões SSH concorrentes
- (-) WebView do SO pode ter inconsistências de renderização entre plataformas (especialmente Linux/GTK)
- (-) Ecossistema de plugins Tauri v2 ainda em maturação (alguns plugins v1 sem port)
- (-) Depuração de IPC é menos intuitiva que chamadas HTTP locais do Electron
