# AGENTS.md

## Overview

Standalone RDP client POC (single Rust binary, ~1300 LOC in `src/main.rs`).
Validates IronRDP for future Tauri integration. NOT a workspace/monorepo — just one crate.

## Commands

```bash
# ALWAYS use --release (debug is 10-100x slower for pixel loops)
cargo build --release
cargo run --release -- --host <IP> -u <USER> -p <PASS> [--size 800x600] [--port 3389] [-d DOMAIN]

# Logging (env var RDP_LOG, NOT RUST_LOG)
RDP_LOG=debug cargo run --release -- ...
RDP_LOG=info,ironrdp_cliprdr=trace cargo run --release -- ...
```

No tests, no linter config, no CI. Validation is manual via real RDP connection.

## Architecture (non-obvious)

- **2 threads**: main thread (winit event loop + rendering) / network thread (blocking I/O)
- Communication: `mpsc` channels for input + clipboard messages, `Arc<Mutex<Vec<u32>>>` for framebuffer
- `ControlFlow::Wait` + `EventLoopProxy<UserEvent::FrameReady>` = zero CPU when idle
- winit 0.30 uses `ApplicationHandler` trait (NOT the old closure-based API)

## Key gotchas

- **Clipboard uses CLI tools** (`wl-paste`/`wl-copy`/`xclip`/`xsel`) — `arboard` crate doesn't work on Wayland when winit owns the display
- **CLIPRDR** (RDP clipboard virtual channel) is wired via `ironrdp-cliprdr` `CliprdrBackend` trait + mpsc channel back to network thread
- `CliprdrBackend` requires `impl_as_any!()` macro from `ironrdp-core`
- **Attach SVC before connect**: `connector.attach_static_channel(cliprdr)` must happen before `connect_begin`
- Clipboard changes detected by polling local clipboard every 500ms with FNV-1a hash comparison
- `ActiveStage::process_svc_processor_messages()` encodes CLIPRDR PDUs for the wire
- `process_clipboard_message()` helper routes `ClipboardMessage` enum variants to the correct `CliprdrClient` methods
- Ctrl+V uses Unicode key injection as fallback (releases ALL modifiers before injecting chars)
- Pixel format: BgrX32 — same memory layout as softbuffer u32, zero conversion needed
- TLS: accepts any certificate (no verification) — POC only
- `TCP_NODELAY` + immediate flush after every input and ACK frame

## Conventions

- Comments and log strings: Portuguese
- Identifiers: English
- Error handling: `anyhow` throughout (no IPC boundary)
- Single-file intentionally — will be modularized during Tauri integration
- Commits: Conventional Commits with scope `rdp` (e.g., `feat(rdp): ...`)
