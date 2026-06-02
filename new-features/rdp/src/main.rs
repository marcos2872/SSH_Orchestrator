//! POC interativa — Cliente RDP com janela (minifb) + mouse + teclado.
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
use minifb::{Key, MouseMode, Window, WindowOptions};
use sspi::network_client::reqwest_network_client::ReqwestNetworkClient;
use tokio_rustls::rustls;
use tracing::info;

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

    // 2. Abrir janela
    let mut window = Window::new(
        &format!("RDP POC - {}@{}", config.username, config.host),
        width,
        height,
        WindowOptions {
            resize: false,
            ..WindowOptions::default()
        },
    )
    .context("falha ao criar janela")?;

    // Poll de input a ~1000Hz sem busy-spin
    window.set_target_fps(1000);

    // 3. Buffer de imagem — BgrX32 = bytes [B,G,R,X] → u32 LE = 0x00RRGGBB (formato minifb)
    let image = DecodedImage::new(
        ironrdp_graphics::image_processing::PixelFormat::BgrX32,
        connection_result.desktop_size.width,
        connection_result.desktop_size.height,
    );

    // 4. Session loop interativo (multi-thread)
    run_session(connection_result, framed, image, &mut window)?;

    println!("[POC] Sessao encerrada.");
    Ok(())
}

// ---------------------------------------------------------------------------
// Session loop — arquitetura multi-thread para baixa latencia
//
// Thread principal (render): janela minifb + captura de input + envia ops via channel
// Thread de rede: le PDUs, processa graficos, envia input, atualiza framebuffer compartilhado
// ---------------------------------------------------------------------------

/// Mensagem de input enviada da thread de render para a thread de rede
enum InputMsg {
    Mouse(Vec<Operation>),
    Keyboard(Vec<Operation>),
    /// Colar texto da clipboard local via UnicodeKeyPressed (bypass CLIPRDR)
    ClipboardPaste(String),
    Quit,
}

fn run_session(
    connection_result: ConnectionResult,
    mut framed: UpgradedFramed,
    mut image: DecodedImage,
    window: &mut Window,
) -> anyhow::Result<()> {
    let width = image.width() as usize;
    let height = image.height() as usize;

    // Buffer unico compartilhado (render le via try_lock, rede escreve)
    let buffer = Arc::new(Mutex::new(vec![0u32; width * height]));
    let frame_ready = Arc::new(AtomicBool::new(false));
    let running = Arc::new(AtomicBool::new(true));

    // Channel para enviar input da thread de render → thread de rede
    let (input_tx, input_rx) = std::sync::mpsc::channel::<InputMsg>();

    // --- Thread de rede ---
    let buf_clone = Arc::clone(&buffer);
    let ready_clone = Arc::clone(&frame_ready);
    let running_clone = Arc::clone(&running);

    let network_thread = thread::spawn(move || -> anyhow::Result<()> {
        let mut active_stage = ActiveStage::new(connection_result);
        let mut input_db = InputDatabase::new();

        // Timeout minimo para nao bloquear (100µs para reduzir latencia)
        let (stream, _) = framed.get_inner_mut();
        stream
            .sock
            .set_read_timeout(Some(Duration::from_micros(100)))
            .ok();

        let mut last_input_time: Option<std::time::Instant> = None;

        while running_clone.load(Ordering::Relaxed) {
            // 1. Processar TODO input pendente com prioridade maxima
            let mut had_input = false;
            while let Ok(msg) = input_rx.try_recv() {
                match msg {
                    InputMsg::Mouse(ops) | InputMsg::Keyboard(ops) => {
                        let events = input_db.apply(ops);
                        let outputs = active_stage.process_fastpath_input(&mut image, &events)?;
                        for out in outputs {
                            if let ActiveStageOutput::ResponseFrame(frame) = out {
                                framed.write_all(&frame)?;
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
                        let outputs = active_stage.process_fastpath_input(&mut image, &events)?;
                        for out in outputs {
                            if let ActiveStageOutput::ResponseFrame(frame) = out {
                                framed.write_all(&frame)?;
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

            // 2. Ler PDUs do servidor (sem limite — drenar tudo disponivel)
            let mut has_update = false;
            loop {
                match framed.read_pdu() {
                    Ok((action, payload)) => {
                        let outputs = active_stage.process(&mut image, action, &payload)?;
                        for out in outputs {
                            match out {
                                ActiveStageOutput::ResponseFrame(frame) => {
                                    // Flush ACK imediato — servidor espera ACK antes de
                                    // enviar proximo frame, atrasar isso causa latencia
                                    // em cascata.
                                    framed.write_all(&frame)?;
                                    framed.get_inner_mut().0.flush()?;
                                }
                                ActiveStageOutput::GraphicsUpdate(_) => {
                                    if let Some(t) = last_input_time.take() {
                                        let elapsed = t.elapsed();
                                        if elapsed.as_millis() > 50 {
                                            tracing::debug!("input→frame latency: {:?}", elapsed);
                                        }
                                    }
                                    has_update = true;
                                }
                                ActiveStageOutput::Terminate(reason) => {
                                    println!("[POC] Servidor encerrou: {:?}", reason);
                                    running_clone.store(false, Ordering::Relaxed);
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
                        running_clone.store(false, Ordering::Relaxed);
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
                if let Ok(mut buf) = buf_clone.try_lock() {
                    copy_xrgb32_to_buffer(&image, &mut buf);
                    ready_clone.store(true, Ordering::Release);
                }
            } else if !had_input {
                // Nenhum dado — sleep curto e previsivel (yield depende do scheduler
                // e pode causar delays de 1-15ms no Linux)
                thread::sleep(Duration::from_micros(100));
            }
        }

        Ok(())
    });

    // --- Thread principal (render + input) ---
    let mut prev_mouse_pos: (f32, f32) = (0.0, 0.0);
    let mut prev_left_down = false;
    let mut prev_right_down = false;
    let mut prev_keys: Vec<Key> = Vec::new();

    while window.is_open() && !window.is_key_down(Key::Escape) && running.load(Ordering::Relaxed) {
        // 0. Atualizar estado de janela/input (poll de eventos do OS)
        if frame_ready.swap(false, Ordering::Acquire) {
            if let Ok(buf) = buffer.lock() {
                window.update_with_buffer(&buf, width, height).unwrap_or(());
            }
        } else {
            window.update();
        }

        // 1. Capturar e enviar input DEPOIS do update (estado de teclas atualizado)
        let mouse_ops = capture_mouse(
            window,
            &mut prev_mouse_pos,
            &mut prev_left_down,
            &mut prev_right_down,
        );
        if !mouse_ops.is_empty() {
            let _ = input_tx.send(InputMsg::Mouse(mouse_ops));
        }

        // Clipboard paste: Ctrl+V interceptado localmente e envia como Unicode.
        // Sem CLIPRDR, Ctrl+V remoto e inutil — usamos para colar clipboard local.
        let current_keys: Vec<Key> = window.get_keys();
        let has_ctrl = current_keys.contains(&Key::LeftCtrl) || current_keys.contains(&Key::RightCtrl);
        let has_v = current_keys.contains(&Key::V);
        let v_is_new = has_v && !prev_keys.contains(&Key::V);
        let clipboard_paste = has_ctrl && v_is_new;

        // Gerar key ops a partir das mesmas current_keys (evita segunda chamada get_keys)
        let key_ops = {
            let mut ops = Vec::new();
            for key in &current_keys {
                if !prev_keys.contains(key) {
                    // Se clipboard paste ativo, nao enviar V nem Ctrl como scancode
                    if clipboard_paste && (*key == Key::V) {
                        continue;
                    }
                    if let Some(sc) = key_to_scancode(*key) {
                        tracing::debug!(?key, ?sc, "KeyPressed");
                        ops.push(Operation::KeyPressed(sc));
                    }
                }
            }
            for key in prev_keys.iter() {
                if !current_keys.contains(key) {
                    if let Some(sc) = key_to_scancode(*key) {
                        tracing::debug!(?key, ?sc, "KeyReleased");
                        ops.push(Operation::KeyReleased(sc));
                    }
                }
            }
            prev_keys = current_keys;
            ops
        };

        if !key_ops.is_empty() && !clipboard_paste {
            let _ = input_tx.send(InputMsg::Keyboard(key_ops));
        }

        if clipboard_paste {
            tracing::info!("Clipboard paste detectado (Ctrl+V)!");
            if let Ok(mut clipboard) = arboard::Clipboard::new() {
                if let Ok(text) = clipboard.get_text() {
                    tracing::info!(len = text.len(), "Clipboard text lido");
                    if !text.is_empty() {
                        let _ = input_tx.send(InputMsg::ClipboardPaste(text));
                    }
                }
            }
        }
    }

    // Sinalizar encerramento
    running.store(false, Ordering::Relaxed);
    let _ = input_tx.send(InputMsg::Quit);

    if let Err(e) = network_thread.join().unwrap_or(Ok(())) {
        println!("[POC] Erro na thread de rede: {e}");
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Conversao RGBA → u32 (0RGB para minifb)
// ---------------------------------------------------------------------------

/// Copia imagem XRgb32 direto para buffer u32 do minifb (formato identico).
/// Apenas copia row-by-row respeitando stride.
fn copy_xrgb32_to_buffer(image: &DecodedImage, out: &mut [u32]) {
    let width = image.width() as usize;
    let height = image.height() as usize;
    let stride = image.stride();
    let data = image.data();

    if stride == width * 4 {
        // SAFETY: DecodedImage garante data.len() >= width * height * 4 quando stride == width*4.
        // O ponteiro de u8 é reinterpretado como u32 (4 bytes por pixel, BgrX32).
        // Alinhamento: data vem de Vec<u8> internamente; em x86_64 alocações são alinhadas a 16 bytes.
        let src =
            unsafe { std::slice::from_raw_parts(data.as_ptr() as *const u32, width * height) };
        out[..width * height].copy_from_slice(src);
    } else {
        // Stride com padding — copia row por row
        for y in 0..height {
            let row_start = y * stride;
            // SAFETY: Cada row tem pelo menos width*4 bytes válidos (stride >= width*4).
            // Mesmo argumento de alinhamento acima.
            let src = unsafe {
                std::slice::from_raw_parts(data[row_start..].as_ptr() as *const u32, width)
            };
            out[y * width..(y + 1) * width].copy_from_slice(src);
        }
    }
}

// ---------------------------------------------------------------------------
// Captura de mouse
// ---------------------------------------------------------------------------

fn capture_mouse(
    window: &Window,
    prev_pos: &mut (f32, f32),
    prev_left: &mut bool,
    prev_right: &mut bool,
) -> Vec<Operation> {
    let mut ops = Vec::new();

    if let Some((x, y)) = window.get_mouse_pos(MouseMode::Clamp) {
        if (x - prev_pos.0).abs() > 0.5 || (y - prev_pos.1).abs() > 0.5 {
            ops.push(Operation::MouseMove(MousePosition {
                x: x as u16,
                y: y as u16,
            }));
            *prev_pos = (x, y);
        }
    }

    let left_down = window.get_mouse_down(minifb::MouseButton::Left);
    let right_down = window.get_mouse_down(minifb::MouseButton::Right);

    if left_down && !*prev_left {
        ops.push(Operation::MouseButtonPressed(MouseButton::Left));
    } else if !left_down && *prev_left {
        ops.push(Operation::MouseButtonReleased(MouseButton::Left));
    }

    if right_down && !*prev_right {
        ops.push(Operation::MouseButtonPressed(MouseButton::Right));
    } else if !right_down && *prev_right {
        ops.push(Operation::MouseButtonReleased(MouseButton::Right));
    }

    *prev_left = left_down;
    *prev_right = right_down;

    // Scroll wheel
    if let Some((scroll_x, scroll_y)) = window.get_scroll_wheel() {
        if scroll_y.abs() > 0.01 {
            ops.push(Operation::WheelRotations(WheelRotations {
                is_vertical: true,
                rotation_units: (scroll_y * 120.0) as i16,
            }));
        }
        if scroll_x.abs() > 0.01 {
            ops.push(Operation::WheelRotations(WheelRotations {
                is_vertical: false,
                rotation_units: (scroll_x * 120.0) as i16,
            }));
        }
    }

    ops
}

// ---------------------------------------------------------------------------
// Captura de teclado — mapeia minifb::Key → scancode
// ---------------------------------------------------------------------------



/// Mapeia minifb::Key para RDP Scancode (Set 1 / XT scancodes).
/// Mapa completo incluindo Numpad, F13-F15, locks, Super, Menu, Pause.
/// Acentos ABNT2: o servidor remoto faz a composicao de dead keys —
/// basta enviar os scancodes fisicos corretos (Apostrophe = ´, Backquote = `,
/// LeftBracket = ~^, Semicolon = ç no layout ABNT2).
fn key_to_scancode(key: Key) -> Option<Scancode> {
    let (extended, code) = match key {
        // Linha numerica
        Key::Key1 => (false, 0x02),
        Key::Key2 => (false, 0x03),
        Key::Key3 => (false, 0x04),
        Key::Key4 => (false, 0x05),
        Key::Key5 => (false, 0x06),
        Key::Key6 => (false, 0x07),
        Key::Key7 => (false, 0x08),
        Key::Key8 => (false, 0x09),
        Key::Key9 => (false, 0x0A),
        Key::Key0 => (false, 0x0B),

        // Letras
        Key::A => (false, 0x1E),
        Key::B => (false, 0x30),
        Key::C => (false, 0x2E),
        Key::D => (false, 0x20),
        Key::E => (false, 0x12),
        Key::F => (false, 0x21),
        Key::G => (false, 0x22),
        Key::H => (false, 0x23),
        Key::I => (false, 0x17),
        Key::J => (false, 0x24),
        Key::K => (false, 0x25),
        Key::L => (false, 0x26),
        Key::M => (false, 0x32),
        Key::N => (false, 0x31),
        Key::O => (false, 0x18),
        Key::P => (false, 0x19),
        Key::Q => (false, 0x10),
        Key::R => (false, 0x13),
        Key::S => (false, 0x1F),
        Key::T => (false, 0x14),
        Key::U => (false, 0x16),
        Key::V => (false, 0x2F),
        Key::W => (false, 0x11),
        Key::X => (false, 0x2D),
        Key::Y => (false, 0x15),
        Key::Z => (false, 0x2C),

        // Modificadores
        Key::LeftShift => (false, 0x2A),
        Key::RightShift => (false, 0x36),
        Key::LeftCtrl => (false, 0x1D),
        Key::RightCtrl => (true, 0x1D),
        Key::LeftAlt => (false, 0x38),
        Key::RightAlt => (true, 0x38), // AltGr no ABNT2
        Key::LeftSuper => (true, 0x5B),
        Key::RightSuper => (true, 0x5C),

        // Locks
        Key::CapsLock => (false, 0x3A),
        Key::NumLock => (false, 0x45),
        Key::ScrollLock => (false, 0x46),

        // Teclas especiais
        Key::Space => (false, 0x39),
        Key::Enter => (false, 0x1C),
        Key::Backspace => (false, 0x0E),
        Key::Tab => (false, 0x0F),
        Key::Escape => (false, 0x01),
        Key::Menu => (true, 0x5D),
        Key::Pause => (false, 0x45), // Pause/Break (scancode especial)

        // Function keys
        Key::F1 => (false, 0x3B),
        Key::F2 => (false, 0x3C),
        Key::F3 => (false, 0x3D),
        Key::F4 => (false, 0x3E),
        Key::F5 => (false, 0x3F),
        Key::F6 => (false, 0x40),
        Key::F7 => (false, 0x41),
        Key::F8 => (false, 0x42),
        Key::F9 => (false, 0x43),
        Key::F10 => (false, 0x44),
        Key::F11 => (false, 0x57),
        Key::F12 => (false, 0x58),
        Key::F13 => (false, 0x64),
        Key::F14 => (false, 0x65),
        Key::F15 => (false, 0x66),

        // Navegacao (extended)
        Key::Up => (true, 0x48),
        Key::Down => (true, 0x50),
        Key::Left => (true, 0x4B),
        Key::Right => (true, 0x4D),
        Key::Home => (true, 0x47),
        Key::End => (true, 0x4F),
        Key::PageUp => (true, 0x49),
        Key::PageDown => (true, 0x51),
        Key::Insert => (true, 0x52),
        Key::Delete => (true, 0x53),

        // Pontuacao / simbolos (posicoes fisicas — no ABNT2:
        //   Apostrophe(0x28) = tecla ´ ` (dead acute/grave)
        //   LeftBracket(0x1A) = tecla ~ ^ (dead tilde/circumflex)
        //   RightBracket(0x1B) = tecla [ {
        //   Backslash(0x2B) = tecla ] }
        //   Semicolon(0x27) = tecla ç Ç
        //   Slash(0x35) = tecla ; : (ABNT2) ou / ? (US)
        //   Backquote(0x29) = tecla ' " (ABNT2)
        // )
        Key::Minus => (false, 0x0C),
        Key::Equal => (false, 0x0D),
        Key::LeftBracket => (false, 0x1A),
        Key::RightBracket => (false, 0x1B),
        Key::Backslash => (false, 0x2B),
        Key::Semicolon => (false, 0x27),
        Key::Apostrophe => (false, 0x28),
        Key::Comma => (false, 0x33),
        Key::Period => (false, 0x34),
        Key::Slash => (false, 0x35),
        Key::Backquote => (false, 0x29),

        // Numpad
        Key::NumPad0 => (false, 0x52),
        Key::NumPad1 => (false, 0x4F),
        Key::NumPad2 => (false, 0x50),
        Key::NumPad3 => (false, 0x51),
        Key::NumPad4 => (false, 0x4B),
        Key::NumPad5 => (false, 0x4C),
        Key::NumPad6 => (false, 0x4D),
        Key::NumPad7 => (false, 0x47),
        Key::NumPad8 => (false, 0x48),
        Key::NumPad9 => (false, 0x49),
        Key::NumPadDot => (false, 0x53),
        Key::NumPadSlash => (true, 0x35),
        Key::NumPadAsterisk => (false, 0x37),
        Key::NumPadMinus => (false, 0x4A),
        Key::NumPadPlus => (false, 0x4E),
        Key::NumPadEnter => (true, 0x1C),

        Key::Unknown | Key::Count => return None,
    };

    Some(Scancode::from_u8(extended, code))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Conexao RDP (TCP → TLS)
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
