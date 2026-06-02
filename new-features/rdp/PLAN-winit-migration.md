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

## Etapas

### 1. Atualizar Cargo.toml

```toml
# Remover
minifb = "0.28"

# Adicionar
winit = "0.30"
softbuffer = "0.4"
```

### 2. Criar a janela (substituir Window::new)

```rust
use winit::event_loop::EventLoop;
use winit::window::WindowAttributes;

let event_loop = EventLoop::new()?;
let window = event_loop.create_window(
    WindowAttributes::default()
        .with_title(format!("RDP POC - {}@{}", username, host))
        .with_inner_size(winit::dpi::LogicalSize::new(width, height))
        .with_resizable(false),
)?;
window.set_ime_allowed(true); // habilita input Unicode/IME
```

### 3. Criar surface de pixels (substituir update_with_buffer)

```rust
use softbuffer::Surface;
let context = softbuffer::Context::new(&window)?;
let mut surface = Surface::new(&context, &window)?;
surface.resize(
    NonZeroU32::new(width as u32).unwrap(),
    NonZeroU32::new(height as u32).unwrap(),
)?;
```

Render: copiar `Arc<Mutex<Vec<u32>>>` -> `surface.buffer_mut()`, entao
`buffer.present()`.

### 4. Event loop (substituir while loop)

```rust
event_loop.run(move |event, elwt| {
    match event {
        Event::WindowEvent { event, .. } => match event {
            // Teclado
            WindowEvent::KeyboardInput { event: key_event, .. } => { ... }
            WindowEvent::ModifiersChanged(mods) => { modifiers = mods.state(); }

            // Mouse
            WindowEvent::CursorMoved { position, .. } => { ... }
            WindowEvent::MouseInput { state, button, .. } => { ... }
            WindowEvent::MouseWheel { delta, .. } => { ... }

            // Lifecycle
            WindowEvent::CloseRequested => { elwt.exit(); }
            WindowEvent::RedrawRequested => { render_frame(); }
            _ => {}
        },
        Event::AboutToWait => {
            window.request_redraw(); // ~vsync ou loop continuo
        }
        _ => {}
    }
});
```

### 5. Mapeamento de teclado

Winit usa `KeyEvent`:
- `event.physical_key` -> `KeyCode` (equivalente ao nosso scancode map)
- `event.text` -> `Option<SmolStr>` (caractere Unicode composto, ja com
  dead keys resolvidos -- resolve acentos!)
- `event.state` -> Pressed/Released

**Estrategia**:
- Para teclas com `text` disponivel E sem Ctrl/Alt segurado:
  usar `Operation::UnicodeKeyPressed(char)` (resolve acentos,
  Shift+;=:, dead keys, tudo automatico)
- Para teclas sem texto (F1-F12, arrows, modifiers) OU com Ctrl/Alt:
  mapear `KeyCode` -> scancode
- Modifiers (Ctrl, Alt, Super, Shift sozinho): sempre enviar como scancode

### 6. Clipboard paste (Ctrl+V)

No event handler de teclado:
```rust
if modifiers.control_key() && key_event.physical_key == KeyCode::KeyV
   && key_event.state == ElementState::Pressed
{
    // Ler clipboard local, enviar como UnicodeKeyPressed
    if let Ok(mut clip) = arboard::Clipboard::new() {
        if let Ok(text) = clip.get_text() {
            input_tx.send(InputMsg::ClipboardPaste(text));
        }
    }
    return; // Nao enviar Ctrl+V como scancode
}
```

### 7. Mouse

Mapeamento direto:
| winit event | Operacao RDP |
|---|---|
| `CursorMoved { position }` | `Operation::MouseMove` |
| `MouseInput { Pressed, Left }` | `Operation::MouseButtonPressed(Left)` |
| `MouseInput { Released, Left }` | `Operation::MouseButtonReleased(Left)` |
| `MouseInput { Pressed, Right }` | `Operation::MouseButtonPressed(Right)` |
| `MouseInput { Released, Right }` | `Operation::MouseButtonReleased(Right)` |
| `MouseWheel { LineDelta(x,y) }` | `Operation::WheelRotations` |

### 8. Render (RedrawRequested)

```rust
WindowEvent::RedrawRequested => {
    if frame_ready.swap(false, Ordering::Acquire) {
        if let Ok(buf) = buffer.lock() {
            let mut sb = surface.buffer_mut().unwrap();
            sb.copy_from_slice(&buf);
            sb.present().unwrap();
        }
    }
}
```

### 9. Control flow / FPS

winit 0.30 usa `ControlFlow`:
- `ControlFlow::Poll` = loop continuo (equivalente ao set_target_fps(1000))
- Ou `ControlFlow::WaitUntil(Instant::now() + Duration::from_millis(1))`

Usar `Poll` para manter latencia minima de input.

---

## Arquivos afetados

| Arquivo | Mudanca |
|---------|---------|
| `Cargo.toml` | -minifb, +winit, +softbuffer |
| `src/main.rs` | Refatorar render loop (thread principal) |

## O que NAO muda

- Thread de rede (leitura PDU, framebuffer write, input_rx processing)
- `InputMsg` enum e channel
- `key_to_scancode()` (adaptado para `KeyCode` do winit em vez de minifb Key)
- `copy_xrgb32_to_buffer()` e formato de pixel
- Logica de conexao RDP
- CLI args

## Beneficios

1. **Combos de teclas funcionam** (XKB nativo)
2. **Acentos automaticos** via `KeyEvent.text` (dead keys resolvidos pelo OS)
3. **Clipboard paste** via Ctrl+V com deteccao confiavel de modifiers
4. **Futuro**: winit e o mesmo crate usado internamente pelo Tauri -- facilita integracao

## Riscos

- softbuffer pode ter overhead minimo vs minifb (improvavel ser mensuravel)
- winit 0.30 tem API de event loop com closures (mais verboso que o while loop)
- Precisa testar em Wayland e X11

## Estimativa

~200-300 linhas de diff no main.rs. Arquitetura permanece igual.
