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

use anyhow::Context as _;
use ironrdp::connector::{self, BitmapConfig, ClientConnector, ConnectionResult, Credentials, DesktopSize};
use ironrdp::input::{Database as InputDatabase, MouseButton, MousePosition, Operation, Scancode};
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

    // Limitar a ~60fps para nao consumir CPU demais
    window.set_target_fps(60);

    // 3. Buffer de imagem
    let mut image = DecodedImage::new(
        ironrdp_graphics::image_processing::PixelFormat::RgbA32,
        connection_result.desktop_size.width,
        connection_result.desktop_size.height,
    );

    // 4. Session loop interativo
    run_session(connection_result, framed, &mut image, &mut window)?;

    println!("[POC] Sessao encerrada.");
    Ok(())
}

// ---------------------------------------------------------------------------
// Session loop interativo
// ---------------------------------------------------------------------------

fn run_session(
    connection_result: ConnectionResult,
    mut framed: UpgradedFramed,
    image: &mut DecodedImage,
    window: &mut Window,
) -> anyhow::Result<()> {
    let mut active_stage = ActiveStage::new(connection_result);
    let mut input_db = InputDatabase::new();

    let width = image.width() as usize;
    let height = image.height() as usize;

    // Buffer u32 para minifb (ARGB format)
    let mut framebuffer: Vec<u32> = vec![0; width * height];

    // Estado anterior do mouse para detectar mudancas
    let mut prev_mouse_pos: (f32, f32) = (0.0, 0.0);
    let mut prev_left_down = false;
    let mut prev_right_down = false;

    // Teclas rastreadas para detectar press/release
    let mut prev_keys: Vec<Key> = Vec::new();

    // Usar timeout curto no TCP para nao bloquear o loop de rendering
    // (ja configurado na conexao com 5s, mas queremos mais rapido aqui)
    set_nonblocking_timeout(&mut framed);

    while window.is_open() && !window.is_key_down(Key::Escape) {
        // --- 1. Ler PDUs do servidor (non-blocking via timeout curto) ---
        let mut got_graphics_update = false;
        loop {
            // processa todos os PDUs disponiveis
            match framed.read_pdu() {
                Ok((action, payload)) => {
                    let outputs = active_stage.process(image, action, &payload)?;
                    for out in outputs {
                        match out {
                            ActiveStageOutput::ResponseFrame(frame) => {
                                framed.write_all(&frame)?;
                            }
                            ActiveStageOutput::GraphicsUpdate(_) => {
                                got_graphics_update = true;
                            }
                            ActiveStageOutput::Terminate(reason) => {
                                println!("[POC] Servidor encerrou: {:?}", reason);
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
                Err(e) => return Err(anyhow::Error::new(e).context("erro lendo PDU")),
            }
        }

        // --- 2. Atualizar framebuffer se houve update grafico ---
        if got_graphics_update {
            rgba_to_argb32(image, &mut framebuffer);
        }

        // --- 3. Renderizar na janela ---
        window
            .update_with_buffer(&framebuffer, width, height)
            .context("falha ao atualizar janela")?;

        // --- 4. Capturar mouse ---
        let mouse_ops = capture_mouse(window, &mut prev_mouse_pos, &mut prev_left_down, &mut prev_right_down);
        if !mouse_ops.is_empty() {
            let events = input_db.apply(mouse_ops);
            let outputs = active_stage.process_fastpath_input(image, &events)?;
            for out in outputs {
                if let ActiveStageOutput::ResponseFrame(frame) = out {
                    framed.write_all(&frame)?;
                }
            }
        }

        // --- 5. Capturar teclado ---
        let key_ops = capture_keyboard(window, &mut prev_keys);
        if !key_ops.is_empty() {
            let events = input_db.apply(key_ops);
            let outputs = active_stage.process_fastpath_input(image, &events)?;
            for out in outputs {
                if let ActiveStageOutput::ResponseFrame(frame) = out {
                    framed.write_all(&frame)?;
                }
            }
        }
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Conversao RGBA → u32 (0RGB para minifb)
// ---------------------------------------------------------------------------

fn rgba_to_argb32(image: &DecodedImage, out: &mut [u32]) {
    let width = image.width() as usize;
    let height = image.height() as usize;
    let stride = image.stride();
    let data = image.data();

    for y in 0..height {
        let row_start = y * stride;
        for x in 0..width {
            let offset = row_start + x * 4;
            let r = data[offset] as u32;
            let g = data[offset + 1] as u32;
            let b = data[offset + 2] as u32;
            out[y * width + x] = (r << 16) | (g << 8) | b;
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

    ops
}

// ---------------------------------------------------------------------------
// Captura de teclado — mapeia minifb::Key → scancode
// ---------------------------------------------------------------------------

fn capture_keyboard(window: &Window, prev_keys: &mut Vec<Key>) -> Vec<Operation> {
    let mut ops = Vec::new();

    let current_keys: Vec<Key> = window.get_keys();

    // Detectar teclas novas (pressed)
    for key in &current_keys {
        if !prev_keys.contains(key) {
            if let Some(sc) = key_to_scancode(*key) {
                ops.push(Operation::KeyPressed(sc));
            }
        }
    }

    // Detectar teclas soltas (released)
    for key in prev_keys.iter() {
        if !current_keys.contains(key) {
            if let Some(sc) = key_to_scancode(*key) {
                ops.push(Operation::KeyReleased(sc));
            }
        }
    }

    *prev_keys = current_keys;
    ops
}

/// Mapeia minifb::Key para RDP Scancode (Set 1 / XT scancodes).
/// Retorna None para teclas nao mapeadas.
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

        // Teclas especiais
        Key::Space => (false, 0x39),
        Key::Enter => (false, 0x1C),
        Key::Backspace => (false, 0x0E),
        Key::Tab => (false, 0x0F),
        Key::LeftShift => (false, 0x2A),
        Key::RightShift => (false, 0x36),
        Key::LeftCtrl => (false, 0x1D),
        Key::RightCtrl => (true, 0x1D),
        Key::LeftAlt => (false, 0x38),
        Key::RightAlt => (true, 0x38),
        Key::CapsLock => (false, 0x3A),

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

        // Pontuacao
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

        _ => return None,
    };

    Some(Scancode::from_u8(extended, code))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn set_nonblocking_timeout(framed: &mut UpgradedFramed) {
    // Timeout curto (10ms) para que o loop nao bloqueie esperando PDUs
    let (stream, _) = framed.get_inner_mut();
    if let Err(e) = stream.sock.set_read_timeout(Some(Duration::from_millis(10))) {
        tracing::warn!("Nao foi possivel ajustar read_timeout: {e}");
    }
}

// ---------------------------------------------------------------------------
// Conexao RDP (TCP → TLS)
// ---------------------------------------------------------------------------

type UpgradedFramed = ironrdp_blocking::Framed<rustls::StreamOwned<rustls::ClientConnection, TcpStream>>;

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
) -> anyhow::Result<(rustls::StreamOwned<rustls::ClientConnection, TcpStream>, Vec<u8>)> {
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
            width: 1280,
            height: 720,
        },
        bitmap: Some(BitmapConfig {
            lossy_compression: true,
            color_depth: 32,
            codecs: client_codecs_capabilities(&["remotefx"]).unwrap(),
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
}

fn parse_args() -> anyhow::Result<CliConfig> {
    let args: Vec<String> = std::env::args().collect();

    let mut host = None;
    let mut port = 3389u16;
    let mut username = None;
    let mut password = None;
    let mut domain = None;

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
            other => anyhow::bail!(
                "argumento desconhecido: {other}\n\nUso: cargo run -- --host <IP> -u <USER> -p <PASS> [--port 3389] [-d DOMAIN]"
            ),
        }
    }

    Ok(CliConfig {
        host: host.context("--host e obrigatorio")?,
        port,
        username: username.context("-u/--username e obrigatorio")?,
        password: password.context("-p/--password e obrigatorio")?,
        domain,
    })
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

fn setup_logging() -> anyhow::Result<()> {
    use tracing::metadata::LevelFilter;
    use tracing_subscriber::EnvFilter;
    use tracing_subscriber::prelude::*;

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
