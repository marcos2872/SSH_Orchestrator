# RDP POC — Validacao com IronRDP

Prova de conceito de um cliente RDP interativo em Rust puro usando [IronRDP](https://github.com/Devolutions/IronRDP).

## Funcionalidades

- Conexao RDP completa (TCP → TLS → CredSSP/NLA)
- Janela interativa com rendering de frames em tempo real (minifb)
- Captura e envio de mouse (move, click esquerdo/direito)
- Captura e envio de teclado (letras, numeros, F1-F12, setas, modifiers)
- Codec RemoteFX para qualidade grafica (32-bit color)

## Uso

```bash
cargo run -- --host <IP> -u <USUARIO> -p <SENHA> [--port 3389] [-d DOMAIN]
```

### Exemplo

```bash
cargo run -- --host 192.168.1.100 -u administrator -p "MinhaSenha"
```

### Controles

- **ESC** — fecha a janela e encerra a sessao
- **Mouse/Teclado** — interacao direta com o desktop remoto

### Logs

```bash
RDP_LOG=debug cargo run -- --host ...
```

## Dependencias principais

| Crate | Versao | Funcao |
|-------|--------|--------|
| `ironrdp` | 0.15 | Protocolo RDP (connector, session, input, graphics) |
| `ironrdp-blocking` | 0.9 | I/O bloqueante para o session loop |
| `ironrdp-pdu` | 0.8 | PDU encoding/decoding |
| `minifb` | 0.28 | Janela com framebuffer para rendering |
| `sspi` | 0.21 | CredSSP/NLA (autenticacao NTLM) |
| `tokio-rustls` | 0.26 | TLS upgrade |

## Notas

- O certificado TLS do servidor e aceito sem verificacao (apenas POC).
- Testado com xrdp (Linux) e Windows Server com RDP habilitado.
- Para servidores que exigem NLA, `enable_credssp: true` esta ativo.
- `autologon: true` e necessario para xrdp passar credenciais ao sesman.
