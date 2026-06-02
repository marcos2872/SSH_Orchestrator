# RDP POC — Cliente interativo com IronRDP

Prova de conceito de um cliente RDP interativo em Rust puro usando [IronRDP](https://github.com/Devolutions/IronRDP).
Valida conexao, rendering, mouse, teclado e scroll antes da integracao no app principal (Tauri).

## Arquitetura

```
Thread principal (render)          Thread de rede
┌────────────────────────┐        ┌──────────────────────────┐
│ minifb window          │        │ TLS socket (TCP_NODELAY) │
│ captura mouse/teclado  │───────>│ envia input + flush      │
│ exibe framebuffer      │<───────│ recebe PDUs + decode     │
│ 1000Hz poll            │        │ ACK imediato ao servidor │
└────────────────────────┘        └──────────────────────────┘
         channel (mpsc)              buffer compartilhado (Arc<Mutex>)
```

- **Zero-copy pixel format**: BgrX32 = layout nativo do minifb, sem conversao por pixel
- **TCP_NODELAY**: elimina buffering Nagle (~200ms) em input events
- **Flush agressivo**: todo input e ACK de frame sao flushed imediatamente
- **RemoteFX codec**: 32-bit color com compressao eficiente

## Funcionalidades

- Conexao RDP completa (TCP -> TLS -> CredSSP/NLA)
- Janela interativa com rendering em tempo real
- Mouse: move, click esquerdo/direito, scroll vertical/horizontal
- Teclado: letras, numeros, F1-F12, setas, modifiers, pontuacao
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

# Com resolucao menor (reduz latencia em xrdp)
cargo run --release -- --host <IP> -u admin -p "senha" --size 800x600
```

### Controles

- **ESC** — fecha a janela e encerra a sessao
- **Mouse/Teclado** — interacao direta com o desktop remoto
- **Scroll** — roda do mouse funciona (vertical e horizontal)

### Logs e debug

```bash
# Logs de conexao (padrao)
cargo run --release -- --host ...

# Logs detalhados com latencia input->frame
RDP_LOG=debug cargo run --release -- --host ...
```

## Performance

| Metrica | Valor tipico |
|---------|-------------|
| Latencia input->frame (xrdp) | 50-100ms (media), 400ms (pico em redesenho grande) |
| Latencia input->frame (Windows) | ~30ms |
| FPS poll de input | 1000Hz |
| Formato de pixel | BgrX32 (zero-copy para minifb) |

> **IMPORTANTE**: O modo debug do Rust e 10-100x mais lento para loops de pixel.
> Sempre use `--release` para testes de latencia.

## Dependencias principais

| Crate | Versao | Funcao |
|-------|--------|--------|
| `ironrdp` | 0.15 | Protocolo RDP (connector, session, input, graphics) |
| `ironrdp-blocking` | 0.9 | I/O bloqueante para o session loop |
| `ironrdp-pdu` | 0.8 | PDU encoding/decoding |
| `minifb` | 0.28 | Janela com framebuffer para rendering |
| `sspi` | 0.21 | CredSSP/NLA (autenticacao NTLM) |
| `tokio-rustls` | 0.26 | TLS upgrade |

## Limitacoes (POC)

- Certificado TLS aceito sem verificacao (inseguro, apenas para validacao)
- Single-file (825 linhas) — sera dividido em modulos na integracao Tauri
- Sem reconnect automatico
- Sem clipboard sharing
- Sem audio redirection
- Cursor remoto (sem cursor local instantaneo)

## Notas tecnicas

- Testado com **xrdp** (Linux) — requer `autologon: true` para sesman/PAM
- `enable_credssp: true` necessario para NLA
- Performance flags desabilitam wallpaper, animacoes e theming para reduzir trafego
- Latencia residual (50-400ms) e inerente ao xrdp (composicao + compressao server-side)
- xfreerdp tem latencia similar — diferenca perceptual vem do cursor local
