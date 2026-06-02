# RDP POC — Cliente interativo com IronRDP

Prova de conceito de um cliente RDP interativo em Rust puro usando [IronRDP](https://github.com/Devolutions/IronRDP).
Valida conexao, rendering, mouse, teclado, clipboard e scroll antes da integracao no app principal (Tauri).

## Arquitetura

```
Thread principal (winit)            Thread de rede
┌────────────────────────┐         ┌──────────────────────────────┐
│ winit window           │         │ TLS socket (TCP_NODELAY)     │
│ captura mouse/teclado  │────────>│ envia input + flush          │
│ exibe framebuffer      │<────────│ recebe PDUs + decode         │
│ ControlFlow::Wait      │         │ ACK imediato ao servidor     │
│ (zero CPU idle)        │         │ CLIPRDR SVC (clipboard)      │
└────────────────────────┘         └──────────────────────────────┘
     channel (mpsc)                   buffer compartilhado (Arc<Mutex>)
     + EventLoopProxy waker           + clipboard channel (mpsc)
```

- **winit 0.30 + softbuffer**: ApplicationHandler trait, zero CPU idle via `ControlFlow::Wait`
- **Zero-copy pixel format**: BgrX32 = layout nativo do softbuffer, sem conversao por pixel
- **TCP_NODELAY**: elimina buffering Nagle (~200ms) em input events
- **Flush agressivo**: todo input e ACK de frame sao flushed imediatamente
- **RemoteFX codec**: 32-bit color com compressao eficiente
- **CLIPRDR**: canal virtual estatico para clipboard bidirecional via protocolo RDP

## Funcionalidades

- Conexao RDP completa (TCP -> TLS -> CredSSP/NLA)
- Janela interativa com rendering em tempo real (winit + softbuffer)
- Mouse: move, click esquerdo/direito, scroll vertical/horizontal
- Teclado: XKB nativo via PhysicalKey/KeyCode, letras, numeros, F1-F12, setas, modifiers, pontuacao
- **Clipboard bidirecional (CLIPRDR)**:
  - Server -> Local: copia no servidor aparece automaticamente no clipboard local (wl-paste)
  - Local -> Server: copia local detectada e anunciada ao servidor (right-click paste funciona)
  - Fallback: Ctrl+V injeta texto via Unicode keypresses (funciona em qualquer app)
- Resolucao configuravel via CLI
- Instrumentacao de latencia (input -> frame)

## Uso

```bash
# Build release (OBRIGATORIO para performance aceitavel)
cargo build --release

# Conectar
cargo run --release -- --host <IP> -u <USUARIO> -p <SENHA>

# Com porta e dominio customizados
cargo run --release -- --host <IP> --port 3390 -u admin -p "senha" -d DOMINIO

# Com resolucao menor (reduz latencia)
cargo run --release -- --host <IP> -u admin -p "senha" --size 800x600
```

### Controles

- **ESC** — fecha a janela e encerra a sessao
- **Ctrl+V / Ctrl+Shift+V** — cola texto do clipboard local (Unicode injection)
- **Right-click paste** — cola via CLIPRDR (nativo, servidor le clipboard do cliente)
- **Mouse/Teclado** — interacao direta com o desktop remoto
- **Scroll** — roda do mouse funciona (vertical e horizontal)

### Logs e debug

```bash
# Logs de conexao (padrao)
cargo run --release -- --host ...

# Logs detalhados com latencia input->frame e CLIPRDR
RDP_LOG=debug cargo run --release -- --host ...

# Trace completo do canal CLIPRDR
RDP_LOG=info,ironrdp_cliprdr=trace cargo run --release -- --host ...
```

## Performance

| Metrica | Valor tipico |
|---------|-------------|
| Latencia input->frame (Windows) | ~30ms |
| Latencia input->frame (xrdp) | 50-100ms (media), 400ms (pico) |
| CPU idle | 0% (ControlFlow::Wait + EventLoopProxy waker) |
| Clipboard poll | 500ms (deteccao de mudancas locais) |
| Formato de pixel | BgrX32 (zero-copy para softbuffer) |

> **IMPORTANTE**: O modo debug do Rust e 10-100x mais lento para loops de pixel.
> Sempre use `--release` para testes de latencia.

## Dependencias principais

| Crate | Versao | Funcao |
|-------|--------|--------|
| `ironrdp` | 0.15 | Protocolo RDP (connector, session, input, graphics, cliprdr, svc) |
| `ironrdp-blocking` | 0.9 | I/O bloqueante para o session loop |
| `ironrdp-pdu` | 0.8 | PDU encoding/decoding |
| `ironrdp-cliprdr` | 0.6 | Canal virtual CLIPRDR (clipboard bidirecional) |
| `ironrdp-svc` | 0.6 | Framework de canais virtuais estaticos |
| `ironrdp-core` | 0.2 | Traits base (AsAny) |
| `winit` | 0.30 | Windowing cross-platform (Wayland/X11) |
| `softbuffer` | 0.4 | Framebuffer rendering |
| `sspi` | 0.21 | CredSSP/NLA (autenticacao NTLM) |
| `tokio-rustls` | 0.26 | TLS upgrade |

## Clipboard (CLIPRDR)

O clipboard funciona via canal virtual estatico (SVC) do protocolo RDP:

```
Local (Linux)                          Remoto (Windows)
┌─────────────┐                        ┌─────────────┐
│ wl-paste    │──> initiate_copy ──────>│ clipboard   │
│ wl-copy     │<── format_data_resp <───│ servidor    │
└─────────────┘                        └─────────────┘
       ^                                      │
       │         on_remote_copy               │
       └──────── format_data_resp <───────────┘
```

- **Monitoramento local**: poll a cada 500ms via `wl-paste`/`xclip`/`xsel`
- **Deteccao de mudanca**: hash FNV-1a para evitar comparacoes de string completas
- **Formatos**: CF_UNICODETEXT (UTF-16LE) como formato primario
- **Fallback**: se CLIPRDR nao estiver disponivel, Ctrl+V usa Unicode key injection

## Limitacoes (POC)

- Certificado TLS aceito sem verificacao (inseguro, apenas para validacao)
- Single-file (~1300 linhas) — sera dividido em modulos na integracao Tauri
- Sem reconnect automatico
- Sem audio redirection
- Sem transferencia de arquivos via clipboard (apenas texto)
- Cursor remoto (sem cursor local instantaneo)

## Notas tecnicas

- Testado com **Windows Server** via Tailscale (100.64.x.x)
- `enable_credssp: true` necessario para NLA
- Performance flags desabilitam wallpaper, animacoes e theming para reduzir trafego
- winit 0.30 usa `ApplicationHandler` trait com `Arc<Window>` para shared ownership
- Clipboard usa ferramentas CLI do sistema (arboard nao funciona no Wayland quando winit controla o display)
