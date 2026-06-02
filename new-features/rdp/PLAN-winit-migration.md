# Plano: Migracao minifb -> winit + softbuffer

## Problema

O `minifb` no Linux (X11/Wayland) tem um bug onde `get_keys()` nao reporta
teclas pressionadas simultaneamente com modificadores (Shift, Ctrl). Isso
quebra combos como Shift+;, Ctrl+V, Ctrl+Shift+V.

## Solucao

Migrar a camada de windowing para `winit` 0.30 + `softbuffer` 0.4:

- **winit**: event loop com eventos de teclado corretos via XKB/Wayland,
  incluindo `KeyEvent.text` (caracteres compostos/Unicode) e
  `ModifiersChanged` para estado de modificadores.
- **softbuffer**: surface de pixels (equivalente ao `update_with_buffer`).

## Escopo

Apenas a thread principal (render + input) muda. A thread de rede
(PDU processing, framebuffer write) permanece identica.

---

## Status: IMPLEMENTADO

A migracao foi concluida. Detalhes da implementacao abaixo.

---

## Arquitetura final

### winit 0.30 (ApplicationHandler trait)

```rust
struct App { ... }

impl ApplicationHandler<UserEvent> for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        // Criar janela + softbuffer surface aqui
        let window = Arc::new(event_loop.create_window(attrs)?);
        let context = softbuffer::Context::new(window.clone())?;
        let surface = softbuffer::Surface::new(&context, window.clone())?;
        self.window = Some(window);
        self.surface = Some(surface);
    }

    fn user_event(&mut self, _el: &ActiveEventLoop, event: UserEvent) {
        // Waker do network thread
        match event {
            UserEvent::FrameReady => window.request_redraw(),
        }
    }

    fn window_event(&mut self, el: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        match event {
            WindowEvent::KeyboardInput { .. } => { /* scancode dispatch */ }
            WindowEvent::ModifiersChanged(mods) => { /* track modifiers */ }
            WindowEvent::CursorMoved { .. } => { /* mouse move */ }
            WindowEvent::MouseInput { .. } => { /* mouse button */ }
            WindowEvent::MouseWheel { .. } => { /* scroll */ }
            WindowEvent::RedrawRequested => { /* blit framebuffer */ }
            WindowEvent::CloseRequested => { el.exit(); }
            _ => {}
        }
    }

    fn about_to_wait(&mut self, _el: &ActiveEventLoop) {
        // ControlFlow::Wait — acordamos via UserEvent::FrameReady
    }
}

event_loop.run_app(&mut app)?;
```

### Network thread waker (EventLoopProxy)

```rust
// Network thread envia waker quando ha frame novo:
if has_update {
    buffer.try_lock() -> copy pixels
    frame_ready.store(true)
    proxy.send_event(UserEvent::FrameReady)  // acorda event loop
}
```

Isso evita `ControlFlow::Poll` (100% CPU) e garante latencia minima.

### Mapeamento de teclado

- `event.physical_key` → `KeyCode` → mapeado para RDP Scancode via `keycode_to_scancode()`
- `event.repeat` → ignorado (servidor RDP gera repeticao)
- Modifiers trackados via `WindowEvent::ModifiersChanged`
- Ctrl+V interceptado para clipboard paste local

### Mouse

| winit event | Operacao RDP |
|---|---|
| `CursorMoved { position }` | `Operation::MouseMove` |
| `MouseInput { Pressed, Left }` | `Operation::MouseButtonPressed(Left)` |
| `MouseInput { Released, Left }` | `Operation::MouseButtonReleased(Left)` |
| `MouseInput { Pressed, Right }` | `Operation::MouseButtonPressed(Right)` |
| `MouseInput { Released, Right }` | `Operation::MouseButtonReleased(Right)` |
| `MouseWheel { LineDelta(x,y) }` | `Operation::WheelRotations` |

### Render (RedrawRequested)

```rust
if frame_ready.swap(false, Acquire) {
    let buf = shared_buffer.lock();
    let mut sb = surface.buffer_mut();
    sb.copy_from_slice(&buf);
    sb.present();
}
```

---

## Arquivos afetados

| Arquivo | Mudanca |
|---------|---------|
| `Cargo.toml` | -minifb, +winit 0.30, +softbuffer 0.4 |
| `src/main.rs` | Reescrito render loop (ApplicationHandler) |

## O que NAO mudou

- Thread de rede (leitura PDU, framebuffer write, input_rx processing)
- `InputMsg` enum e channel
- `copy_xrgb32_to_buffer()` e formato de pixel
- Logica de conexao RDP
- CLI args
- ACK flush imediato (otimizacao de latencia)

## Beneficios

1. **Combos de teclas funcionam** (XKB nativo, ModifiersChanged)
2. **Key repeat controlado** — ignoramos repeat (server gera), evita input duplicado
3. **Clipboard paste** via Ctrl+V com deteccao confiavel de modifiers
4. **CPU eficiente** — ControlFlow::Wait + EventLoopProxy (nao faz polling)
5. **Futuro**: winit e o mesmo crate usado internamente pelo Tauri — facilita integracao
6. **IntlBackslash** (tecla ABNT2 extra entre Shift e Z) agora mapeada
