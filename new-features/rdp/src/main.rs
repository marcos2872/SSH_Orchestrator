//! POC interativa — Cliente RDP com janela (winit + softbuffer) + mouse + teclado.
//!
//! # Uso
//!
//! ```shell
//! cargo run -- --host <IP> -u <USUARIO> -p <SENHA>
//! ```

#![allow(clippy::print_stdout)]

use core::time::Duration;
use std::io::Write as _;
use std::net::TcpStream;
use std::num::NonZeroU32;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use anyhow::Context as _;
use ironrdp::connector::{
    self, BitmapConfig, ClientConnector, ConnectionResult, Credentials, DesktopSize,
};
use ironrdp::input::{
    Database as InputDatabase, MouseButton, MousePosition, Operation, Scancode, WheelRotations,
};
use ironrdp::pdu::gcc::KeyboardType;
use ironrdp::pdu::rdp::capability_sets::MajorPlatformType;
use ironrdp::session::image::DecodedImage;
use ironrdp::session::{ActiveStage, ActiveStageOutput};
use ironrdp_pdu::rdp::capability_sets::client_codecs_capabilities;
use ironrdp_pdu::rdp::client_info::{PerformanceFlags, TimezoneInfo};
use sspi::network_client::reqwest_network_client::ReqwestNetworkClient;
use tokio_rustls::rustls;
use tracing::info;
use winit::application::ApplicationHandler;
use winit::dpi::LogicalSize;
use winit::event::{ElementState, MouseScrollDelta, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop, EventLoopProxy};
use winit::keyboard::{KeyCode, ModifiersState, PhysicalKey};
use winit::window::{Window, WindowAttributes, WindowId};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

fn main() -> anyhow::Result<()> {
    setup_logging()?;

    let config = parse_args()?;
    info!(host = %config.host, port = config.port, user = %config.username, "Iniciando POC RDP");

    // 1. Conectar
    let connector_config = build_connector_config(&config)?;
    let (connection_result, framed) =
        connect(connector_config, &config.host, config.port).context("falha na conexao RDP")?;

    let width = connection_result.desktop_size.width as usize;
    let height = connection_result.desktop_size.height as usize;
    info!(width, height, "Conectado! Abrindo janela...");

    // 2. Criar event loop e proxy para waker
    let event_loop = EventLoop::<UserEvent>::with_user_event()
        .build()
        .context("falha ao criar event loop")?;
    event_loop.set_control_flow(ControlFlow::Wait);

    let proxy = event_loop.create_proxy();

    // 3. Buffer de imagem — BgrX32 = bytes [B,G,R,X] -> u32 LE = 0x00RRGGBB
    let image = DecodedImage::new(
        ironrdp_graphics::image_processing::PixelFormat::BgrX32,
        connection_result.desktop_size.width,
        connection_result.desktop_size.height,
    );

    // 4. Shared state
    let buffer = Arc::new(Mutex::new(vec![0u32; width * height]));
    let frame_ready = Arc::new(AtomicBool::new(false));
    let running = Arc::new(AtomicBool::new(true));
    let (input_tx, input_rx) = std::sync::mpsc::channel::<InputMsg>();

    // 5. Spawn network thread
    let network_thread = spawn_network_thread(
        connection_result,
        framed,
        image,
        input_rx,
        Arc::clone(&buffer),
        Arc::clone(&frame_ready),
        Arc::clone(&running),
        proxy.clone(),
    );

    // 6. Criar app e rodar
    let mut app = App {
        width: width as u32,
        height: height as u32,
        window: None,
        surface: None,
        buffer: Arc::clone(&buffer),
        frame_ready: Arc::clone(&frame_ready),
        running: Arc::clone(&running),
        input_tx,
        modifiers: ModifiersState::empty(),
        title: format!("RDP POC - {}@{}", config.username, config.host),
        network_thread: Some(network_thread),
    };

    event_loop.run_app(&mut app).context("event loop error")?;

    // Aguardar thread de rede
    app.running.store(false, Ordering::Relaxed);
    if let Some(handle) = app.network_thread.take() {
        if let Err(e) = handle.join().unwrap_or(Ok(())) {
            println!("[POC] Erro na thread de rede: {e}");
        }
    }

    println!("[POC] Sessao encerrada.");
    Ok(())
}

// ---------------------------------------------------------------------------
// User event (waker do network thread)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
enum UserEvent {
    FrameReady,
}

// ---------------------------------------------------------------------------
// Input message (render thread -> network thread)
// ---------------------------------------------------------------------------

enum InputMsg {
    Mouse(Vec<Operation>),
    Keyboard(Vec<Operation>),
    ClipboardPaste(String),
    Quit,
}

// ---------------------------------------------------------------------------
// App struct (ApplicationHandler)
// ---------------------------------------------------------------------------

struct App {
    width: u32,
    height: u32,
    window: Option<Arc<Window>>,
    surface: Option<softbuffer::Surface<Arc<Window>, Arc<Window>>>,
    buffer: Arc<Mutex<Vec<u32>>>,
    frame_ready: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
    input_tx: std::sync::mpsc::Sender<InputMsg>,
    modifiers: ModifiersState,
    title: String,
    network_thread: Option<thread::JoinHandle<anyhow::Result<()>>>,
}

impl ApplicationHandler<UserEvent> for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return; // Ja criada
        }

        let attrs = WindowAttributes::default()
            .with_title(&self.title)
            .with_inner_size(LogicalSize::new(self.width, self.height))
            .with_resizable(false);

        let window = Arc::new(event_loop.create_window(attrs).expect("falha ao criar janela"));

        let context =
            softbuffer::Context::new(window.clone()).expect("falha ao criar softbuffer context");
        let mut surface =
            softbuffer::Surface::new(&context, window.clone()).expect("falha ao criar surface");

        surface
            .resize(
                NonZeroU32::new(self.width).unwrap(),
                NonZeroU32::new(self.height).unwrap(),
            )
            .expect("falha ao redimensionar surface");

        self.surface = Some(surface);
        self.window = Some(window);
    }

    fn user_event(&mut self, _event_loop: &ActiveEventLoop, event: UserEvent) {
        match event {
            UserEvent::FrameReady => {
                if let Some(ref window) = self.window {
                    window.request_redraw();
                }
            }
        }
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        _window_id: WindowId,
        event: WindowEvent,
    ) {
        match event {
            WindowEvent::CloseRequested => {
                self.running.store(false, Ordering::Relaxed);
                let _ = self.input_tx.send(InputMsg::Quit);
                event_loop.exit();
            }

            WindowEvent::RedrawRequested => {
                if self.frame_ready.swap(false, Ordering::Acquire) {
                    if let (Some(surface), Ok(buf)) =
                        (self.surface.as_mut(), self.buffer.lock())
                    {
                        if let Ok(mut sb) = surface.buffer_mut() {
                            let len = buf.len().min(sb.len());
                            sb[..len].copy_from_slice(&buf[..len]);
                            sb.present().unwrap_or(());
                        }
                    }
                }
            }

            WindowEvent::ModifiersChanged(mods) => {
                self.modifiers = mods.state();
            }

            WindowEvent::KeyboardInput { event, .. } => {
                // Ctrl+V: clipboard paste local
                if self.modifiers.control_key()
                    && event.physical_key == PhysicalKey::Code(KeyCode::KeyV)
                    && event.state == ElementState::Pressed
                    && !event.repeat
                {
                    if let Ok(mut clipboard) = arboard::Clipboard::new() {
                        if let Ok(text) = clipboard.get_text() {
                            if !text.is_empty() {
                                tracing::info!(len = text.len(), "Clipboard paste");
                                let _ = self.input_tx.send(InputMsg::ClipboardPaste(text));
                            }
                        }
                    }
                    return;
                }

                // Teclas normais: mapear para scancode
                if let PhysicalKey::Code(code) = event.physical_key {
                    if let Some(sc) = keycode_to_scancode(code) {
                        let op = match event.state {
                            ElementState::Pressed => {
                                if event.repeat {
                                    return; // RDP nao precisa de repeat, server gera
                                }
                                tracing::debug!(?code, ?sc, "KeyPressed");
                                Operation::KeyPressed(sc)
                            }
                            ElementState::Released => {
                                tracing::debug!(?code, ?sc, "KeyReleased");
                                Operation::KeyReleased(sc)
                            }
                        };
                        let _ = self.input_tx.send(InputMsg::Keyboard(vec![op]));
                    }
                }
            }

            WindowEvent::CursorMoved { position, .. } => {
                let ops = vec![Operation::MouseMove(MousePosition {
                    x: position.x as u16,
                    y: position.y as u16,
                })];
                let _ = self.input_tx.send(InputMsg::Mouse(ops));
            }

            WindowEvent::MouseInput { state, button, .. } => {
                let btn = match button {
                    winit::event::MouseButton::Left => MouseButton::Left,
                    winit::event::MouseButton::Right => MouseButton::Right,
                    winit::event::MouseButton::Middle => MouseButton::Middle,
                    _ => return,
                };
                let op = match state {
                    ElementState::Pressed => Operation::MouseButtonPressed(btn),
                    ElementState::Released => Operation::MouseButtonReleased(btn),
                };
                let _ = self.input_tx.send(InputMsg::Mouse(vec![op]));
            }

            WindowEvent::MouseWheel { delta, .. } => {
                let (dx, dy) = match delta {
                    MouseScrollDelta::LineDelta(x, y) => (x, y),
                    MouseScrollDelta::PixelDelta(pos) => {
                        (pos.x as f32 / 10.0, pos.y as f32 / 10.0)
                    }
                };
                let mut ops = Vec::new();
                if dy.abs() > 0.01 {
                    ops.push(Operation::WheelRotations(WheelRotations {
                        is_vertical: true,
                        rotation_units: (dy * 120.0) as i16,
                    }));
                }
                if dx.abs() > 0.01 {
                    ops.push(Operation::WheelRotations(WheelRotations {
                        is_vertical: false,
                        rotation_units: (dx * 120.0) as i16,
                    }));
                }
                if !ops.is_empty() {
                    let _ = self.input_tx.send(InputMsg::Mouse(ops));
                }
            }

            _ => {}
        }
    }

    fn about_to_wait(&mut self, _event_loop: &ActiveEventLoop) {
        // Nada — usamos ControlFlow::Wait + UserEvent::FrameReady como waker
    }
}

// ---------------------------------------------------------------------------
// Network thread
// ---------------------------------------------------------------------------

fn spawn_network_thread(
    connection_result: ConnectionResult,
    mut framed: UpgradedFramed,
    mut image: DecodedImage,
    input_rx: std::sync::mpsc::Receiver<InputMsg>,
    buffer: Arc<Mutex<Vec<u32>>>,
    frame_ready: Arc<AtomicBool>,
    running: Arc<AtomicBool>,
    proxy: EventLoopProxy<UserEvent>,
) -> thread::JoinHandle<anyhow::Result<()>> {
    thread::spawn(move || -> anyhow::Result<()> {
        let mut active_stage = ActiveStage::new(connection_result);
        let mut input_db = InputDatabase::new();

        // Timeout minimo para nao bloquear (100us para reduzir latencia)
        let (stream, _) = framed.get_inner_mut();
        stream
            .sock
            .set_read_timeout(Some(Duration::from_micros(100)))
            .ok();

        let mut last_input_time: Option<std::time::Instant> = None;

        while running.load(Ordering::Relaxed) {
            // 1. Processar TODO input pendente com prioridade maxima
            let mut had_input = false;
            while let Ok(msg) = input_rx.try_recv() {
                match msg {
                    InputMsg::Mouse(ops) | InputMsg::Keyboard(ops) => {
                        let events = input_db.apply(ops);
                        let outputs =
                            active_stage.process_fastpath_input(&mut image, &events)?;
                        for out in outputs {
                            if let ActiveStageOutput::ResponseFrame(frame) = out {
                                framed.write_all(&frame)?;
                                framed.get_inner_mut().0.flush()?;
                            }
                        }
                        had_input = true;
                    }
                    InputMsg::ClipboardPaste(text) => {
                        let ops: Vec<Operation> = text
                            .chars()
                            .flat_map(|c| {
                                [
                                    Operation::UnicodeKeyPressed(c),
                                    Operation::UnicodeKeyReleased(c),
                                ]
                            })
                            .collect();
                        let events = input_db.apply(ops);
                        let outputs =
                            active_stage.process_fastpath_input(&mut image, &events)?;
                        for out in outputs {
                            if let ActiveStageOutput::ResponseFrame(frame) = out {
                                framed.write_all(&frame)?;
                                framed.get_inner_mut().0.flush()?;
                            }
                        }
                        had_input = true;
                    }
                    InputMsg::Quit => return Ok(()),
                }
            }

            // Se teve input, flush imediato do socket para minimizar latencia
            if had_input {
                framed.get_inner_mut().0.flush()?;
                last_input_time = Some(std::time::Instant::now());
            }

            // 2. Ler PDUs do servidor (drenar tudo disponivel)
            let mut has_update = false;
            loop {
                match framed.read_pdu() {
                    Ok((action, payload)) => {
                        let outputs = active_stage.process(&mut image, action, &payload)?;
                        for out in outputs {
                            match out {
                                ActiveStageOutput::ResponseFrame(frame) => {
                                    // Flush ACK imediato — servidor espera ACK antes de
                                    // enviar proximo frame
                                    framed.write_all(&frame)?;
                                    framed.get_inner_mut().0.flush()?;
                                }
                                ActiveStageOutput::GraphicsUpdate(_) => {
                                    if let Some(t) = last_input_time.take() {
                                        let elapsed = t.elapsed();
                                        if elapsed.as_millis() > 50 {
                                            tracing::debug!(
                                                "input->frame latency: {:?}",
                                                elapsed
                                            );
                                        }
                                    }
                                    has_update = true;
                                }
                                ActiveStageOutput::Terminate(reason) => {
                                    println!("[POC] Servidor encerrou: {:?}", reason);
                                    running.store(false, Ordering::Relaxed);
                                    return Ok(());
                                }
                                _ => {}
                            }
                        }
                    }
                    Err(e)
                        if e.kind() == std::io::ErrorKind::WouldBlock
                            || e.kind() == std::io::ErrorKind::TimedOut =>
                    {
                        break;
                    }
                    Err(e) => {
                        running.store(false, Ordering::Relaxed);
                        return Err(anyhow::Error::new(e).context("erro lendo PDU"));
                    }
                }

                // Checar input entre PDUs para nao criar starvation
                if let Ok(msg) = input_rx.try_recv() {
                    match msg {
                        InputMsg::Mouse(ops) | InputMsg::Keyboard(ops) => {
                            let events = input_db.apply(ops);
                            let outputs =
                                active_stage.process_fastpath_input(&mut image, &events)?;
                            for out in outputs {
                                if let ActiveStageOutput::ResponseFrame(frame) = out {
                                    framed.write_all(&frame)?;
                                    framed.get_inner_mut().0.flush()?;
                                }
                            }
                        }
                        InputMsg::ClipboardPaste(text) => {
                            let ops: Vec<Operation> = text
                                .chars()
                                .flat_map(|c| {
                                    [
                                        Operation::UnicodeKeyPressed(c),
                                        Operation::UnicodeKeyReleased(c),
                                    ]
                                })
                                .collect();
                            let events = input_db.apply(ops);
                            let outputs =
                                active_stage.process_fastpath_input(&mut image, &events)?;
                            for out in outputs {
                                if let ActiveStageOutput::ResponseFrame(frame) = out {
                                    framed.write_all(&frame)?;
                                    framed.get_inner_mut().0.flush()?;
                                }
                            }
                        }
                        InputMsg::Quit => return Ok(()),
                    }
                }
            }

            // 3. Atualizar buffer e sinalizar frame pronto
            if has_update {
                if let Ok(mut buf) = buffer.try_lock() {
                    copy_xrgb32_to_buffer(&image, &mut buf);
                    frame_ready.store(true, Ordering::Release);
                    // Acordar event loop para fazer redraw
                    let _ = proxy.send_event(UserEvent::FrameReady);
                }
            } else if !had_input {
                // Nenhum dado — sleep curto e previsivel
                thread::sleep(Duration::from_micros(100));
            }
        }

        Ok(())
    })
}

// ---------------------------------------------------------------------------
// Conversao RGBA -> u32 (0RGB para softbuffer)
// ---------------------------------------------------------------------------

/// Copia imagem XRgb32 direto para buffer u32 (formato identico BgrX32 = 0x00RRGGBB).
fn copy_xrgb32_to_buffer(image: &DecodedImage, out: &mut [u32]) {
    let width = image.width() as usize;
    let height = image.height() as usize;
    let stride = image.stride();
    let data = image.data();

    if stride == width * 4 {
        // SAFETY: DecodedImage garante data.len() >= width * height * 4 quando stride == width*4.
        // O ponteiro de u8 e reinterpretado como u32 (4 bytes por pixel, BgrX32).
        let src =
            unsafe { std::slice::from_raw_parts(data.as_ptr() as *const u32, width * height) };
        out[..width * height].copy_from_slice(src);
    } else {
        // Stride com padding — copia row por row
        for y in 0..height {
            let row_start = y * stride;
            // SAFETY: Cada row tem pelo menos width*4 bytes validos (stride >= width*4).
            let src = unsafe {
                std::slice::from_raw_parts(data[row_start..].as_ptr() as *const u32, width)
            };
            out[y * width..(y + 1) * width].copy_from_slice(src);
        }
    }
}

// ---------------------------------------------------------------------------
// Mapeamento KeyCode (winit) -> Scancode (RDP)
// ---------------------------------------------------------------------------

/// Mapeia winit KeyCode para RDP Scancode (Set 1 / XT scancodes).
fn keycode_to_scancode(key: KeyCode) -> Option<Scancode> {
    let (extended, code) = match key {
        // Linha numerica
        KeyCode::Digit1 => (false, 0x02),
        KeyCode::Digit2 => (false, 0x03),
        KeyCode::Digit3 => (false, 0x04),
        KeyCode::Digit4 => (false, 0x05),
        KeyCode::Digit5 => (false, 0x06),
        KeyCode::Digit6 => (false, 0x07),
        KeyCode::Digit7 => (false, 0x08),
        KeyCode::Digit8 => (false, 0x09),
        KeyCode::Digit9 => (false, 0x0A),
        KeyCode::Digit0 => (false, 0x0B),

        // Letras
        KeyCode::KeyA => (false, 0x1E),
        KeyCode::KeyB => (false, 0x30),
        KeyCode::KeyC => (false, 0x2E),
        KeyCode::KeyD => (false, 0x20),
        KeyCode::KeyE => (false, 0x12),
        KeyCode::KeyF => (false, 0x21),
        KeyCode::KeyG => (false, 0x22),
        KeyCode::KeyH => (false, 0x23),
        KeyCode::KeyI => (false, 0x17),
        KeyCode::KeyJ => (false, 0x24),
        KeyCode::KeyK => (false, 0x25),
        KeyCode::KeyL => (false, 0x26),
        KeyCode::KeyM => (false, 0x32),
        KeyCode::KeyN => (false, 0x31),
        KeyCode::KeyO => (false, 0x18),
        KeyCode::KeyP => (false, 0x19),
        KeyCode::KeyQ => (false, 0x10),
        KeyCode::KeyR => (false, 0x13),
        KeyCode::KeyS => (false, 0x1F),
        KeyCode::KeyT => (false, 0x14),
        KeyCode::KeyU => (false, 0x16),
        KeyCode::KeyV => (false, 0x2F),
        KeyCode::KeyW => (false, 0x11),
        KeyCode::KeyX => (false, 0x2D),
        KeyCode::KeyY => (false, 0x15),
        KeyCode::KeyZ => (false, 0x2C),

        // Modificadores
        KeyCode::ShiftLeft => (false, 0x2A),
        KeyCode::ShiftRight => (false, 0x36),
        KeyCode::ControlLeft => (false, 0x1D),
        KeyCode::ControlRight => (true, 0x1D),
        KeyCode::AltLeft => (false, 0x38),
        KeyCode::AltRight => (true, 0x38), // AltGr no ABNT2
        KeyCode::SuperLeft => (true, 0x5B),
        KeyCode::SuperRight => (true, 0x5C),

        // Locks
        KeyCode::CapsLock => (false, 0x3A),
        KeyCode::NumLock => (false, 0x45),
        KeyCode::ScrollLock => (false, 0x46),

        // Teclas especiais
        KeyCode::Space => (false, 0x39),
        KeyCode::Enter => (false, 0x1C),
        KeyCode::Backspace => (false, 0x0E),
        KeyCode::Tab => (false, 0x0F),
        KeyCode::Escape => (false, 0x01),
        KeyCode::ContextMenu => (true, 0x5D),
        KeyCode::Pause => (false, 0x45),

        // Function keys
        KeyCode::F1 => (false, 0x3B),
        KeyCode::F2 => (false, 0x3C),
        KeyCode::F3 => (false, 0x3D),
        KeyCode::F4 => (false, 0x3E),
        KeyCode::F5 => (false, 0x3F),
        KeyCode::F6 => (false, 0x40),
        KeyCode::F7 => (false, 0x41),
        KeyCode::F8 => (false, 0x42),
        KeyCode::F9 => (false, 0x43),
        KeyCode::F10 => (false, 0x44),
        KeyCode::F11 => (false, 0x57),
        KeyCode::F12 => (false, 0x58),
        KeyCode::F13 => (false, 0x64),
        KeyCode::F14 => (false, 0x65),
        KeyCode::F15 => (false, 0x66),

        // Navegacao (extended)
        KeyCode::ArrowUp => (true, 0x48),
        KeyCode::ArrowDown => (true, 0x50),
        KeyCode::ArrowLeft => (true, 0x4B),
        KeyCode::ArrowRight => (true, 0x4D),
        KeyCode::Home => (true, 0x47),
        KeyCode::End => (true, 0x4F),
        KeyCode::PageUp => (true, 0x49),
        KeyCode::PageDown => (true, 0x51),
        KeyCode::Insert => (true, 0x52),
        KeyCode::Delete => (true, 0x53),

        // Pontuacao / simbolos
        KeyCode::Minus => (false, 0x0C),
        KeyCode::Equal => (false, 0x0D),
        KeyCode::BracketLeft => (false, 0x1A),
        KeyCode::BracketRight => (false, 0x1B),
        KeyCode::Backslash => (false, 0x2B),
        KeyCode::Semicolon => (false, 0x27),
        KeyCode::Quote => (false, 0x28),
        KeyCode::Comma => (false, 0x33),
        KeyCode::Period => (false, 0x34),
        KeyCode::Slash => (false, 0x35),
        KeyCode::Backquote => (false, 0x29),
        KeyCode::IntlBackslash => (false, 0x56), // Tecla extra ABNT2 (entre Shift e Z)

        // Numpad
        KeyCode::Numpad0 => (false, 0x52),
        KeyCode::Numpad1 => (false, 0x4F),
        KeyCode::Numpad2 => (false, 0x50),
        KeyCode::Numpad3 => (false, 0x51),
        KeyCode::Numpad4 => (false, 0x4B),
        KeyCode::Numpad5 => (false, 0x4C),
        KeyCode::Numpad6 => (false, 0x4D),
        KeyCode::Numpad7 => (false, 0x47),
        KeyCode::Numpad8 => (false, 0x48),
        KeyCode::Numpad9 => (false, 0x49),
        KeyCode::NumpadDecimal => (false, 0x53),
        KeyCode::NumpadDivide => (true, 0x35),
        KeyCode::NumpadMultiply => (false, 0x37),
        KeyCode::NumpadSubtract => (false, 0x4A),
        KeyCode::NumpadAdd => (false, 0x4E),
        KeyCode::NumpadEnter => (true, 0x1C),

        _ => return None,
    };

    Some(Scancode::from_u8(extended, code))
}

// ---------------------------------------------------------------------------
// Conexao RDP (TCP -> TLS)
// ---------------------------------------------------------------------------

type UpgradedFramed =
    ironrdp_blocking::Framed<rustls::StreamOwned<rustls::ClientConnection, TcpStream>>;

fn connect(
    config: connector::Config,
    server_name: &str,
    port: u16,
) -> anyhow::Result<(ConnectionResult, UpgradedFramed)> {
    use std::net::ToSocketAddrs as _;

    let server_addr = (server_name, port)
        .to_socket_addrs()?
        .next()
        .context("nao foi possivel resolver o endereco")?;

    info!(%server_addr, "Conectando via TCP...");
    let tcp_stream = TcpStream::connect(server_addr).context("falha no TCP connect")?;
    tcp_stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    tcp_stream
        .set_nodelay(true)
        .context("falha ao setar TCP_NODELAY")?;

    let client_addr = tcp_stream.local_addr()?;
    let mut framed = ironrdp_blocking::Framed::new(tcp_stream);
    let mut connector = ClientConnector::new(config, client_addr);

    let should_upgrade = ironrdp_blocking::connect_begin(&mut framed, &mut connector)
        .context("falha no connect_begin (negociacao X.224)")?;

    info!("TLS upgrade...");
    let initial_stream = framed.into_inner_no_leftover();
    let (upgraded_stream, server_public_key) =
        tls_upgrade(initial_stream, server_name.to_owned()).context("falha no TLS upgrade")?;

    let upgraded = ironrdp_blocking::mark_as_upgraded(should_upgrade, &mut connector);
    let mut upgraded_framed = ironrdp_blocking::Framed::new(upgraded_stream);

    info!("Finalizando conexao...");
    let mut network_client = ReqwestNetworkClient;
    let connection_result = ironrdp_blocking::connect_finalize(
        upgraded,
        connector,
        &mut upgraded_framed,
        &mut network_client,
        server_name.into(),
        server_public_key,
        None,
    )
    .context("falha no connect_finalize")?;

    Ok((connection_result, upgraded_framed))
}

// ---------------------------------------------------------------------------
// TLS
// ---------------------------------------------------------------------------

fn tls_upgrade(
    stream: TcpStream,
    server_name: String,
) -> anyhow::Result<(
    rustls::StreamOwned<rustls::ClientConnection, TcpStream>,
    Vec<u8>,
)> {
    let mut config = rustls::client::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(std::sync::Arc::new(NoCertificateVerification))
        .with_no_client_auth();

    config.key_log = std::sync::Arc::new(rustls::KeyLogFile::new());
    config.resumption = rustls::client::Resumption::disabled();

    let config = std::sync::Arc::new(config);
    let server_name_dns = server_name.try_into()?;
    let client = rustls::ClientConnection::new(config, server_name_dns)?;
    let mut tls_stream = rustls::StreamOwned::new(client, stream);
    tls_stream.flush()?;

    let cert = tls_stream
        .conn
        .peer_certificates()
        .and_then(|certs| certs.first())
        .context("certificado do peer nao encontrado")?;

    let server_public_key = extract_server_public_key(cert)?;
    Ok((tls_stream, server_public_key))
}

fn extract_server_public_key(cert: &[u8]) -> anyhow::Result<Vec<u8>> {
    use x509_cert::der::Decode as _;
    let cert = x509_cert::Certificate::from_der(cert)?;
    let key = cert
        .tbs_certificate
        .subject_public_key_info
        .subject_public_key
        .as_bytes()
        .context("public key BIT STRING nao alinhado")?
        .to_owned();
    Ok(key)
}

// ---------------------------------------------------------------------------
// Configuracao do connector
// ---------------------------------------------------------------------------

fn build_connector_config(config: &CliConfig) -> anyhow::Result<connector::Config> {
    Ok(connector::Config {
        credentials: Credentials::UsernamePassword {
            username: config.username.clone(),
            password: config.password.clone(),
        },
        domain: config.domain.clone(),
        enable_tls: true,
        enable_credssp: true,
        keyboard_type: KeyboardType::IbmEnhanced,
        keyboard_subtype: 0,
        keyboard_layout: 0,
        keyboard_functional_keys_count: 12,
        ime_file_name: String::new(),
        dig_product_id: String::new(),
        desktop_size: DesktopSize {
            width: config.width,
            height: config.height,
        },
        bitmap: Some(BitmapConfig {
            lossy_compression: true,
            color_depth: 32,
            codecs: client_codecs_capabilities(&["remotefx"])
                .map_err(|e| anyhow::anyhow!("falha ao criar codec RemoteFX: {e}"))?,
        }),
        client_build: 0,
        client_name: "rdp-poc".to_owned(),
        client_dir: "C:\\Windows\\System32\\mstscax.dll".to_owned(),
        platform: MajorPlatformType::UNIX,
        enable_server_pointer: true,
        request_data: None,
        autologon: true,
        enable_audio_playback: false,
        compression_type: None,
        pointer_software_rendering: true,
        multitransport_flags: None,
        performance_flags: PerformanceFlags::DISABLE_WALLPAPER
            | PerformanceFlags::DISABLE_FULLWINDOWDRAG
            | PerformanceFlags::DISABLE_MENUANIMATIONS
            | PerformanceFlags::DISABLE_THEMING
            | PerformanceFlags::DISABLE_CURSORSETTINGS,
        desktop_scale_factor: 0,
        hardware_id: None,
        license_cache: None,
        timezone_info: TimezoneInfo::default(),
        alternate_shell: String::new(),
        work_dir: String::new(),
    })
}

// ---------------------------------------------------------------------------
// Parse de argumentos
// ---------------------------------------------------------------------------

struct CliConfig {
    host: String,
    port: u16,
    username: String,
    password: String,
    domain: Option<String>,
    width: u16,
    height: u16,
}

fn parse_args() -> anyhow::Result<CliConfig> {
    let args: Vec<String> = std::env::args().collect();

    let mut host = None;
    let mut port = 3389u16;
    let mut username = None;
    let mut password = None;
    let mut domain = None;
    let mut width: u16 = 1280;
    let mut height: u16 = 720;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--host" => {
                host = Some(args.get(i + 1).context("--host requer valor")?.clone());
                i += 2;
            }
            "--port" => {
                port = args.get(i + 1).context("--port requer valor")?.parse()?;
                i += 2;
            }
            "-u" | "--username" => {
                username = Some(args.get(i + 1).context("-u requer valor")?.clone());
                i += 2;
            }
            "-p" | "--password" => {
                password = Some(args.get(i + 1).context("-p requer valor")?.clone());
                i += 2;
            }
            "-d" | "--domain" => {
                domain = Some(args.get(i + 1).context("-d requer valor")?.clone());
                i += 2;
            }
            "--size" => {
                let val = args.get(i + 1).context("--size requer valor WxH (ex: 800x600)")?;
                let parts: Vec<&str> = val.split('x').collect();
                if parts.len() != 2 {
                    anyhow::bail!("--size formato: WxH (ex: 800x600)");
                }
                width = parts[0].parse().context("largura invalida")?;
                height = parts[1].parse().context("altura invalida")?;
                i += 2;
            }
            other => anyhow::bail!(
                "argumento desconhecido: {other}\n\nUso: cargo run -- --host <IP> -u <USER> -p <PASS> [--port 3389] [-d DOMAIN] [--size 1280x720]"
            ),
        }
    }

    Ok(CliConfig {
        host: host.context("--host e obrigatorio")?,
        port,
        username: username.context("-u e obrigatorio")?,
        password: password.context("-p e obrigatorio")?,
        domain,
        width,
        height,
    })
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

fn setup_logging() -> anyhow::Result<()> {
    use tracing::metadata::LevelFilter;
    use tracing_subscriber::prelude::*;
    use tracing_subscriber::EnvFilter;

    let fmt_layer = tracing_subscriber::fmt::layer().compact();
    let env_filter = EnvFilter::builder()
        .with_default_directive(LevelFilter::INFO.into())
        .with_env_var("RDP_LOG")
        .from_env_lossy();

    tracing_subscriber::registry()
        .with(fmt_layer)
        .with(env_filter)
        .try_init()
        .context("falha ao inicializar logging")?;

    Ok(())
}

// ---------------------------------------------------------------------------
// TLS cert verifier (aceita qualquer cert — apenas POC)
// ---------------------------------------------------------------------------

#[derive(Debug)]
struct NoCertificateVerification;

impl rustls::client::danger::ServerCertVerifier for NoCertificateVerification {
    fn verify_server_cert(
        &self,
        _: &rustls::pki_types::CertificateDer<'_>,
        _: &[rustls::pki_types::CertificateDer<'_>],
        _: &rustls::pki_types::ServerName<'_>,
        _: &[u8],
        _: rustls::pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _: &[u8],
        _: &rustls::pki_types::CertificateDer<'_>,
        _: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _: &[u8],
        _: &rustls::pki_types::CertificateDer<'_>,
        _: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        vec![
            rustls::SignatureScheme::RSA_PKCS1_SHA256,
            rustls::SignatureScheme::RSA_PKCS1_SHA384,
            rustls::SignatureScheme::RSA_PKCS1_SHA512,
            rustls::SignatureScheme::ECDSA_NISTP256_SHA256,
            rustls::SignatureScheme::ECDSA_NISTP384_SHA384,
            rustls::SignatureScheme::ECDSA_NISTP521_SHA512,
            rustls::SignatureScheme::RSA_PSS_SHA256,
            rustls::SignatureScheme::RSA_PSS_SHA384,
            rustls::SignatureScheme::RSA_PSS_SHA512,
            rustls::SignatureScheme::ED25519,
            rustls::SignatureScheme::ED448,
        ]
    }
}
