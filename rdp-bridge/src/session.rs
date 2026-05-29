//! Gerenciador de sessões RDP usando IronRDP blocking API.
//!
//! Cada sessão roda em uma thread dedicada (spawn_blocking) com um canal
//! mpsc para receber comandos de input do parent.

use std::collections::HashMap;
use std::io::Write;
use std::net::TcpStream;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use base64::Engine;
use tokio::sync::mpsc;
use tracing::{debug, error, info, trace, warn};

use ironrdp_blocking::{connect_begin, connect_finalize, mark_as_upgraded, Framed};
use ironrdp_connector::legacy;
use ironrdp_connector::sspi::generator::NetworkRequest;
use ironrdp_connector::sspi::network_client::NetworkClient;
use ironrdp_connector::{self as connector, Credentials, DesktopSize, Sequence, Written};
use ironrdp_connector::connection_activation::ConnectionActivationSequence;
use ironrdp_graphics::image_processing::PixelFormat;
use ironrdp_graphics::rdp6::BitmapStreamDecoder;
use ironrdp_graphics::rle as rle_decompress;
use ironrdp_pdu::bitmap::{BitmapUpdateData, Compression};
use ironrdp_pdu::gcc::KeyboardType;
use ironrdp_pdu::input::fast_path::{FastPathInputEvent, KeyboardFlags};
use ironrdp_pdu::input::mouse::{MousePdu, PointerFlags};
use ironrdp_pdu::rdp::capability_sets::MajorPlatformType;
use ironrdp_pdu::rdp::client_info::{PerformanceFlags, TimezoneInfo};
use ironrdp_pdu::rdp::headers::ShareDataPdu;
use ironrdp_pdu::Action;
use ironrdp_session::image::DecodedImage;
use ironrdp_session::{ActiveStage, ActiveStageOutput};
use ironrdp_core::{Decode as _, ReadCursor};
use tokio_rustls::rustls;

use crate::protocol::Event;

/// Mensagem interna enviada para a thread de sessão
#[derive(Debug)]
pub enum SessionInput {
    Mouse { x: u16, y: u16, flags: u16 },
    Key { scancode: u16, is_pressed: bool, is_extended: bool },
    Unicode { code_point: u16, is_pressed: bool },
    Clipboard { text: String },
    Resize { width: u16, height: u16 },
    Disconnect,
}

struct ActiveSession {
    input_tx: mpsc::UnboundedSender<SessionInput>,
    join_handle: tokio::task::JoinHandle<()>,
}

pub struct SessionManager {
    sessions: HashMap<String, ActiveSession>,
    event_tx: mpsc::UnboundedSender<Event>,
}

impl SessionManager {
    pub fn new(event_tx: mpsc::UnboundedSender<Event>) -> Self {
        Self {
            sessions: HashMap::new(),
            event_tx,
        }
    }

    pub async fn handle_command(&mut self, cmd: crate::protocol::Command) -> Result<()> {
        use crate::protocol::Command;
        match cmd {
            Command::Connect {
                session_id,
                host,
                port,
                username,
                password,
                width,
                height,
                use_tls,
            } => {
                self.connect(session_id, host, port, username, password, width, height, use_tls)
                    .await
            }
            Command::Disconnect { session_id } => self.disconnect(&session_id).await,
            Command::Mouse { session_id, x, y, flags } => {
                self.send_input(&session_id, SessionInput::Mouse { x, y, flags })
            }
            Command::Key { session_id, scancode, is_pressed, is_extended } => {
                self.send_input(&session_id, SessionInput::Key { scancode, is_pressed, is_extended })
            }
            Command::Unicode { session_id, code_point, is_pressed } => {
                self.send_input(&session_id, SessionInput::Unicode { code_point, is_pressed })
            }
            Command::Clipboard { session_id, text } => {
                self.send_input(&session_id, SessionInput::Clipboard { text })
            }
            Command::Resize { session_id, width, height } => {
                self.send_input(&session_id, SessionInput::Resize { width, height })
            }
        }
    }

    async fn connect(
        &mut self,
        session_id: String,
        host: String,
        port: u16,
        username: String,
        password: String,
        width: u16,
        height: u16,
        _use_tls: bool,
    ) -> Result<()> {
        if self.sessions.contains_key(&session_id) {
            anyhow::bail!("Sessão {} já existe", session_id);
        }

        let (input_tx, input_rx) = mpsc::unbounded_channel();
        let event_tx = self.event_tx.clone();
        let sid = session_id.clone();

        let join_handle = tokio::task::spawn_blocking(move || {
            if let Err(e) = run_rdp_session(
                &sid, &host, port, &username, &password, width, height, input_rx, &event_tx,
            ) {
                error!("Sessão RDP {} encerrada com erro: {}", sid, e);
                let _ = event_tx.send(Event::Disconnected {
                    session_id: sid,
                    reason: e.to_string(),
                });
            }
        });

        self.sessions.insert(
            session_id,
            ActiveSession {
                input_tx,
                join_handle,
            },
        );

        Ok(())
    }

    async fn disconnect(&mut self, session_id: &str) -> Result<()> {
        if let Some(session) = self.sessions.remove(session_id) {
            let _ = session.input_tx.send(SessionInput::Disconnect);
            let _ = session.join_handle.await;
            info!("Sessão {} desconectada", session_id);
        }
        Ok(())
    }

    pub async fn disconnect_all(&mut self) {
        let ids: Vec<String> = self.sessions.keys().cloned().collect();
        for id in ids {
            let _ = self.disconnect(&id).await;
        }
    }

    fn send_input(&self, session_id: &str, input: SessionInput) -> Result<()> {
        if let Some(session) = self.sessions.get(session_id) {
            session
                .input_tx
                .send(input)
                .map_err(|_| anyhow::anyhow!("Sessão {} não está mais ativa", session_id))?;
        } else {
            anyhow::bail!("Sessão {} não encontrada", session_id);
        }
        Ok(())
    }
}

/// NetworkClient no-op para quando CredSSP está desabilitado
struct NoOpNetworkClient;

impl NetworkClient for NoOpNetworkClient {
    fn send(&self, _request: &NetworkRequest) -> ironrdp_connector::sspi::Result<Vec<u8>> {
        Err(ironrdp_connector::sspi::Error::new(
            ironrdp_connector::sspi::ErrorKind::NoAuthenticatingAuthority,
            "CredSSP desabilitado".to_string(),
        ))
    }
}

/// Tipo do stream após TLS upgrade
type TlsStream = rustls::StreamOwned<rustls::ClientConnection, TcpStream>;
type UpgradedFramed = Framed<TlsStream>;

/// Executa uma sessão RDP bloqueante em uma thread dedicada.
fn run_rdp_session(
    session_id: &str,
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    width: u16,
    height: u16,
    mut input_rx: mpsc::UnboundedReceiver<SessionInput>,
    event_tx: &mpsc::UnboundedSender<Event>,
) -> Result<()> {
    info!(
        "Conectando sessão {} a {}:{} ({}x{})",
        session_id, host, port, width, height
    );

    // Configuração do connector
    let config = connector::Config {
        credentials: Credentials::UsernamePassword {
            username: username.to_string(),
            password: password.to_string(),
        },
        domain: None,
        enable_tls: true,
        enable_credssp: false, // xrdp geralmente não requer NLA
        keyboard_type: KeyboardType::IbmEnhanced,
        keyboard_subtype: 0,
        keyboard_layout: 0,
        keyboard_functional_keys_count: 12,
        ime_file_name: String::new(),
        dig_product_id: String::new(),
        desktop_size: DesktopSize { width, height },
        bitmap: None,
        client_build: 0,
        client_name: "SSHOrchestrator".to_string(),
        client_dir: "C:\\Windows\\System32\\mstscax.dll".to_string(),
        platform: MajorPlatformType::UNIX,
        enable_server_pointer: true,
        pointer_software_rendering: false,
        request_data: None,
        autologon: false,
        enable_audio_playback: false,
        performance_flags: PerformanceFlags::default(),
        desktop_scale_factor: 0,
        hardware_id: None,
        license_cache: None,
        timezone_info: TimezoneInfo::default(),
    };

    // Conexão TCP
    let addr = format!("{}:{}", host, port);
    let tcp_stream = TcpStream::connect(&addr)
        .with_context(|| format!("Falha ao conectar TCP em {}", addr))?;
    tcp_stream.set_nodelay(true)?;
    // NÃO definir read_timeout aqui — o handshake precisa de tempo ilimitado.
    // O timeout será definido após connect_finalize, só para o loop de frames.

    let client_addr = tcp_stream.local_addr().context("endereço local do socket")?;

    let mut framed = Framed::new(tcp_stream);
    let mut connector = connector::ClientConnector::new(config, client_addr);

    // Fase 1: Conexão até ponto de upgrade TLS
    let should_upgrade = connect_begin(&mut framed, &mut connector)
        .map_err(|e| anyhow::anyhow!("connect_begin falhou: {:?}", e))?;

    debug!("TLS upgrade para sessão {}", session_id);

    // TLS upgrade
    let initial_stream = framed.into_inner_no_leftover();
    let (tls_stream, server_public_key) = tls_upgrade(initial_stream, host.to_string())
        .context("TLS upgrade falhou")?;

    let upgraded = mark_as_upgraded(should_upgrade, &mut connector);

    let mut upgraded_framed = Framed::new(tls_stream);

    // Fase 2: Finalizar conexão (CredSSP skip + restante da sequência)
    let mut network_client = NoOpNetworkClient;
    let connection_result = connect_finalize(
        upgraded,
        connector,
        &mut upgraded_framed,
        &mut network_client,
        host.to_string().into(),
        server_public_key,
        None,
    )
    .map_err(|e| anyhow::anyhow!("connect_finalize falhou: {:?}", e))?;

    let desktop_width = connection_result.desktop_size.width;
    let desktop_height = connection_result.desktop_size.height;

    info!(
        "Sessão {} conectada (desktop {}x{})",
        session_id, desktop_width, desktop_height
    );

    // Notificar parent que conectou
    let _ = event_tx.send(Event::Connected {
        session_id: session_id.to_string(),
        width: desktop_width,
        height: desktop_height,
    });

    // Criar imagem decodificada e estágio ativo
    let mut image = DecodedImage::new(PixelFormat::RgbA32, desktop_width, desktop_height);
    let mut active_stage = ActiveStage::new(connection_result);

    // Agora que a conexão está estabelecida, definir read_timeout para o loop de polling
    // Acessar o TcpStream interno do TLS stream para setar o timeout
    upgraded_framed
        .get_inner_mut()
        .0
        .get_mut()
        .set_read_timeout(Some(Duration::from_millis(16)))
        .ok();

    // Loop principal: processar frames do server + input do client
    // Contadores de diagnóstico (logados periodicamente em nível info)
    let mut diag_x224 = 0usize;
    let mut diag_fastpath = 0usize;
    let mut diag_slowpath_bitmap = 0usize;
    let mut diag_frames_emitted = 0usize;
    let mut diag_graphics_update = 0usize;
    let mut diag_last_report = std::time::Instant::now();
    loop {
        // Relatório periódico de diagnóstico
        if diag_last_report.elapsed() >= Duration::from_secs(2) {
            info!(
                "DIAG sessão {} — x224={} fastpath={} slowpath_bitmap={} graphics_update={} frames_emitidos={}",
                session_id, diag_x224, diag_fastpath, diag_slowpath_bitmap,
                diag_graphics_update, diag_frames_emitted
            );
            diag_last_report = std::time::Instant::now();
        }
        // 1. Verificar input do client
        match input_rx.try_recv() {
            Ok(SessionInput::Disconnect) => {
                info!("Sessão {} recebeu comando de desconexão", session_id);
                // Graceful shutdown
                if let Ok(outputs) = active_stage.graceful_shutdown() {
                    for out in outputs {
                        if let ActiveStageOutput::ResponseFrame(frame) = out {
                            let _ = upgraded_framed.write_all(&frame);
                        }
                    }
                }
                break;
            }
            Ok(input) => {
                handle_input(&mut active_stage, &mut upgraded_framed, &mut image, input, event_tx, session_id)?;
            }
            Err(mpsc::error::TryRecvError::Empty) => {}
            Err(mpsc::error::TryRecvError::Disconnected) => {
                info!("Canal de input fechado para sessão {}", session_id);
                break;
            }
        }

        // 2. Ler frame do server (com timeout curto para não bloquear)
        match upgraded_framed.read_pdu() {
            Ok((action, payload)) => {
                trace!(
                    "Sessão {} — PDU recebido: action={:?}, len={}",
                    session_id, action, payload.len()
                );

                // Tentar interceptar slow-path Update PDU (bitmap updates)
                if action == Action::X224 {
                    diag_x224 += 1;
                    match try_handle_slowpath_bitmap(
                        &payload, &mut image, event_tx, session_id,
                    ) {
                        Some(emitted) => {
                            diag_slowpath_bitmap += 1;
                            diag_frames_emitted += emitted;
                            continue;
                        }
                        None => {
                            // Não é bitmap update — cair no processamento normal
                        }
                    }
                } else {
                    diag_fastpath += 1;
                }

                let outputs = match active_stage.process(&mut image, action, &payload) {
                    Ok(outputs) => outputs,
                    Err(e) => {
                        // PDU não suportado — ignorar e continuar
                        debug!("Sessão {} — PDU não processado (ignorando): {:?}", session_id, e);
                        continue;
                    }
                };

                for out in outputs {
                    match out {
                        ActiveStageOutput::ResponseFrame(frame) => {
                            upgraded_framed
                                .write_all(&frame)
                                .map_err(|e| anyhow::anyhow!("Erro escrevendo resposta: {:?}", e))?;
                        }
                        ActiveStageOutput::GraphicsUpdate(rect) => {
                            // Fast-path bitmap real escrito na DecodedImage pelo ActiveStage.
                            // Com pointer_software_rendering=false, não há compositing de cursor,
                            // então GraphicsUpdate aqui representa conteúdo legítimo de desktop.
                            diag_graphics_update += 1;
                            diag_frames_emitted += 1;
                            emit_frame_update(
                                &image,
                                rect.left,
                                rect.top,
                                rect.right,
                                rect.bottom,
                                event_tx,
                                session_id,
                            );
                        }
                        ActiveStageOutput::Terminate(reason) => {
                            info!("Sessão {} terminada pelo server: {}", session_id, reason);
                            let _ = event_tx.send(Event::Disconnected {
                                session_id: session_id.to_string(),
                                reason: reason.description(),
                            });
                            return Ok(());
                        }
                        ActiveStageOutput::PointerDefault
                        | ActiveStageOutput::PointerHidden
                        | ActiveStageOutput::PointerPosition { .. }
                        | ActiveStageOutput::PointerBitmap(_) => {
                            // TODO: Enviar eventos de cursor para o frontend
                        }
                        ActiveStageOutput::DeactivateAll(cas) => {
                            info!("DeactivateAll recebido — executando reativação");
                            match run_reactivation(cas, &mut upgraded_framed) {
                                Ok(new_size) => {
                                    info!("Reativação concluída: {}x{}", new_size.width, new_size.height);
                                    // Recriar DecodedImage com novo tamanho
                                    image = DecodedImage::new(
                                        PixelFormat::RgbA32,
                                        new_size.width,
                                        new_size.height,
                                    );
                                    // Notificar frontend da nova resolução
                                    let _ = event_tx.send(Event::Resolution {
                                        session_id: session_id.to_string(),
                                        width: new_size.width,
                                        height: new_size.height,
                                    });
                                }
                                Err(e) => {
                                    error!("Falha na reativação: {:?}", e);
                                }
                            }
                        }
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock || e.kind() == std::io::ErrorKind::TimedOut => {
                // Sem dados disponíveis — continuar loop
            }
            Err(e) => {
                return Err(anyhow::anyhow!("Erro lendo do server: {:?}", e));
            }
        }
    }

    let _ = event_tx.send(Event::Disconnected {
        session_id: session_id.to_string(),
        reason: "Desconectado pelo usuário".to_string(),
    });

    Ok(())
}

/// Processa um comando de input do client e envia para o server
fn handle_input(
    active_stage: &mut ActiveStage,
    framed: &mut UpgradedFramed,
    image: &mut DecodedImage,
    input: SessionInput,
    _event_tx: &mpsc::UnboundedSender<Event>,
    _session_id: &str,
) -> Result<()> {
    let events: Vec<FastPathInputEvent> = match input {
        SessionInput::Mouse { x, y, flags } => {
            vec![FastPathInputEvent::MouseEvent(MousePdu {
                flags: PointerFlags::from_bits_truncate(flags),
                number_of_wheel_rotation_units: 0,
                x_position: x,
                y_position: y,
            })]
        }
        SessionInput::Key { scancode, is_pressed, is_extended } => {
            let mut flags = KeyboardFlags::empty();
            if !is_pressed {
                flags |= KeyboardFlags::RELEASE;
            }
            if is_extended {
                flags |= KeyboardFlags::EXTENDED;
            }
            #[allow(clippy::cast_possible_truncation)]
            let code = scancode as u8;
            vec![FastPathInputEvent::KeyboardEvent(flags, code)]
        }
        SessionInput::Unicode { code_point, is_pressed } => {
            let flags = if is_pressed {
                KeyboardFlags::empty()
            } else {
                KeyboardFlags::RELEASE
            };
            vec![FastPathInputEvent::UnicodeKeyboardEvent(flags, code_point)]
        }
        SessionInput::Clipboard { .. } => {
            // TODO: Implementar clipboard via cliprdr SVC
            debug!("Clipboard ainda não implementado no loop ativo");
            return Ok(());
        }
        SessionInput::Resize { width, height } => {
            // Tentar resize via Display Control Virtual Channel
            if let Some(result) = active_stage.encode_resize(u32::from(width), u32::from(height), None, None) {
                let frame = result.map_err(|e| anyhow::anyhow!("Erro no resize: {:?}", e))?;
                framed.write_all(&frame).map_err(|e| anyhow::anyhow!("Erro escrevendo resize: {:?}", e))?;
            } else {
                warn!("Display Control Virtual Channel não disponível para resize");
            }
            return Ok(());
        }
        SessionInput::Disconnect => return Ok(()), // Tratado no loop principal
    };

    if !events.is_empty() {
        let outputs = active_stage
            .process_fastpath_input(image, &events)
            .map_err(|e| anyhow::anyhow!("Erro processando input: {:?}", e))?;

        for out in outputs {
            match out {
                ActiveStageOutput::ResponseFrame(frame) => {
                    framed.write_all(&frame).map_err(|e| anyhow::anyhow!("Erro escrevendo input frame: {:?}", e))?;
                }
                ActiveStageOutput::GraphicsUpdate(rect) => {
                    // Pointer moved — pode precisar re-emitir região
                    debug!("Graphics update após input: {:?}", rect);
                }
                _ => {}
            }
        }
    }

    Ok(())
}

/// Executa a sequência de reativação após DeactivateAll (usado após resize).
/// Lê PDUs do servidor e responde até atingir o estado Finalized com o novo DesktopSize.
fn run_reactivation(
    mut cas: Box<ConnectionActivationSequence>,
    framed: &mut UpgradedFramed,
) -> Result<DesktopSize> {
    use ironrdp_connector::connection_activation::ConnectionActivationState;
    use ironrdp_core::WriteBuf;

    let mut buf = WriteBuf::new();

    loop {
        buf.clear();

        let written = if let Some(hint) = cas.next_pdu_hint() {
            let pdu = framed.read_by_hint(hint)
                .map_err(|e| anyhow::anyhow!("Erro lendo PDU na reativação: {:?}", e))?;
            cas.step(&pdu, &mut buf)
                .map_err(|e| anyhow::anyhow!("Erro no step de reativação: {:?}", e))?
        } else {
            cas.step_no_input(&mut buf)
                .map_err(|e| anyhow::anyhow!("Erro no step_no_input de reativação: {:?}", e))?
        };

        if let Some(response_len) = written.size() {
            let response = &buf[..response_len];
            framed.write_all(response)
                .map_err(|e| anyhow::anyhow!("Erro escrevendo resposta de reativação: {:?}", e))?;
        }

        // Verificar se atingimos o estado terminal (Finalized)
        let state = cas.connection_activation_state();
        if let ConnectionActivationState::Finalized { desktop_size, .. } = state {
            return Ok(desktop_size);
        }
    }
}

/// Extrai e emite uma região atualizada da imagem como RGBA raw base64
fn emit_frame_update(
    image: &DecodedImage,
    left: u16,
    top: u16,
    right: u16,
    bottom: u16,
    event_tx: &mpsc::UnboundedSender<Event>,
    session_id: &str,
) {
    let x = left;
    let y = top;
    let w = right.saturating_sub(left) + 1;
    let h = bottom.saturating_sub(top) + 1;

    if w == 0 || h == 0 {
        return;
    }

    // Extrair região retangular da imagem completa (RGBA, 4 bytes/pixel)
    let stride = image.width() as usize * 4;
    let mut region_data = Vec::with_capacity(w as usize * h as usize * 4);

    let img_data = image.data();
    for row in y..(y + h) {
        let row_start = row as usize * stride + x as usize * 4;
        let row_end = row_start + w as usize * 4;
        if row_end <= img_data.len() {
            region_data.extend_from_slice(&img_data[row_start..row_end]);
        }
    }

    let data_b64 = base64::engine::general_purpose::STANDARD.encode(&region_data);

    let _ = event_tx.send(Event::Frame {
        session_id: session_id.to_string(),
        x,
        y,
        width: w,
        height: h,
        format: "rgba".to_string(),
        data_b64,
    });
}

/// Realiza TLS upgrade no stream TCP
fn tls_upgrade(
    stream: TcpStream,
    server_name: String,
) -> Result<(TlsStream, Vec<u8>)> {
    let mut config = rustls::client::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(NoCertificateVerification))
        .with_no_client_auth();

    // Desabilitar resumption (não suportado por CredSSP e alguns xrdp)
    config.resumption = rustls::client::Resumption::disabled();

    let config = Arc::new(config);
    let server_name_ref: rustls::pki_types::ServerName<'_> = server_name.try_into()
        .map_err(|e| anyhow::anyhow!("Nome de servidor inválido para TLS: {:?}", e))?;

    let client = rustls::ClientConnection::new(config, server_name_ref)
        .context("Falha ao criar conexão TLS")?;

    let mut tls_stream = rustls::StreamOwned::new(client, stream);

    // Flush para garantir que o handshake TLS avança
    tls_stream.flush().context("Falha no flush do TLS handshake")?;

    // Extrair chave pública do certificado do server
    let server_public_key = tls_stream
        .conn
        .peer_certificates()
        .and_then(|certs| certs.first())
        .map(|cert| extract_tls_server_public_key(cert))
        .transpose()?
        .unwrap_or_default();

    Ok((tls_stream, server_public_key))
}

/// Extrai a chave pública do certificado TLS do servidor
fn extract_tls_server_public_key(cert: &[u8]) -> Result<Vec<u8>> {
    use x509_cert::der::Decode as _;

    let cert = x509_cert::Certificate::from_der(cert)
        .context("Falha ao decodificar certificado X.509")?;

    let server_public_key = cert
        .tbs_certificate
        .subject_public_key_info
        .subject_public_key
        .as_bytes()
        .context("chave pública BIT STRING não alinhada")?
        .to_owned();

    Ok(server_public_key)
}

/// Verificador de certificado que aceita qualquer certificado (necessário para xrdp)
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
            rustls::SignatureScheme::RSA_PKCS1_SHA1,
            rustls::SignatureScheme::ECDSA_SHA1_Legacy,
            rustls::SignatureScheme::RSA_PKCS1_SHA256,
            rustls::SignatureScheme::ECDSA_NISTP256_SHA256,
            rustls::SignatureScheme::RSA_PKCS1_SHA384,
            rustls::SignatureScheme::ECDSA_NISTP384_SHA384,
            rustls::SignatureScheme::RSA_PKCS1_SHA512,
            rustls::SignatureScheme::ECDSA_NISTP521_SHA512,
            rustls::SignatureScheme::RSA_PSS_SHA256,
            rustls::SignatureScheme::RSA_PSS_SHA384,
            rustls::SignatureScheme::RSA_PSS_SHA512,
            rustls::SignatureScheme::ED25519,
            rustls::SignatureScheme::ED448,
        ]
    }
}

// ─── Slow-path Bitmap Update handling ────────────────────────────────────────

/// Tenta interceptar e processar um slow-path Update PDU (bitmap).
/// Retorna Some(n) com o número de frames emitidos se era Update PDU (consumido),
/// None se não era Update PDU (deixar para o active_stage processar).
fn try_handle_slowpath_bitmap(
    frame: &[u8],
    image: &mut DecodedImage,
    event_tx: &mpsc::UnboundedSender<Event>,
    session_id: &str,
) -> Option<usize> {
    // Decodificar o Send Data Indication
    let data_ctx = match legacy::decode_send_data_indication(frame) {
        Ok(ctx) => ctx,
        Err(e) => {
            debug!("decode_send_data_indication falhou: {:?}", e);
            return None;
        }
    };
    let io_channel = match legacy::decode_io_channel(data_ctx) {
        Ok(ch) => ch,
        Err(e) => {
            debug!("decode_io_channel falhou: {:?}", e);
            return None;
        }
    };

    match io_channel {
        legacy::IoChannelPdu::Data(ctx) => {
            if let ShareDataPdu::Update(raw_update) = ctx.pdu {
                // raw_update = updateType(u16) + updateData
                // Para slow-path NÃO há pad2Octets (isso é só no wrapper TS_UPDATE_PDU_DATA)
                // Na verdade, ironrdp-pdu consome o cursor no ponto exato APÓS o ShareDataPduType,
                // então raw_update = bytes restantes do Share Data PDU body
                //
                // MS-RDPBCGR 2.2.9.1.1.3.1.2 Bitmap Update:
                //   updateType(u16) = 0x0001 (UPDATETYPE_BITMAP)
                //   seguido de TS_UPDATE_BITMAP_DATA
                //
                // Mas na prática, o ironrdp já consumiu o updateType no
                // ShareDataPduType::Update (0x02) decode. Os bytes aqui são o
                // conteúdo raw APÓS o share_data_pdu header/type.
                //
                // Tentamos decodificar direto como BitmapUpdateData. Se falhar,
                // tentamos pular 2 bytes (updateType field).

                let mut cursor = ReadCursor::new(&raw_update);
                match BitmapUpdateData::decode(&mut cursor) {
                    Ok(bitmap_update) => {
                        debug!("Slow-path bitmap update: {} rectangles", bitmap_update.rectangles.len());
                        return Some(process_bitmap_update(bitmap_update, image, event_tx, session_id));
                    }
                    Err(_) => {}
                }

                // Fallback: pular updateType(u16) e tentar novamente
                if raw_update.len() > 2 {
                    let mut cursor2 = ReadCursor::new(&raw_update[2..]);
                    match BitmapUpdateData::decode(&mut cursor2) {
                        Ok(bitmap_update) => {
                            debug!("Slow-path bitmap update (skip 2): {} rectangles", bitmap_update.rectangles.len());
                            return Some(process_bitmap_update(bitmap_update, image, event_tx, session_id));
                        }
                        Err(_) => {}
                    }
                }

                // Fallback: pular updateType(u16) + pad2Octets(u16) = 4 bytes
                if raw_update.len() > 4 {
                    let mut cursor3 = ReadCursor::new(&raw_update[4..]);
                    match BitmapUpdateData::decode(&mut cursor3) {
                        Ok(bitmap_update) => {
                            debug!("Slow-path bitmap update (skip 4): {} rectangles", bitmap_update.rectangles.len());
                            return Some(process_bitmap_update(bitmap_update, image, event_tx, session_id));
                        }
                        Err(e) => {
                            debug!("Falha ao decodificar BitmapUpdateData (todas tentativas): {:?}", e);
                        }
                    }
                }

                // É um Update PDU mas não conseguimos parsear — consumir mesmo assim
                debug!("Update PDU não reconhecido (len={}, primeiros bytes={:?})",
                    raw_update.len(), &raw_update[..raw_update.len().min(16)]);
                Some(0)
            } else {
                // Não é Update PDU — deixar para active_stage processar
                None
            }
        }
        legacy::IoChannelPdu::DeactivateAll(_) => None,
    }
}

/// Processa bitmap updates decodificados e emite diretamente como frame events.
/// Retorna o número de retângulos emitidos como frames.
fn process_bitmap_update(
    bitmap_update: BitmapUpdateData<'_>,
    _image: &mut DecodedImage,
    event_tx: &mpsc::UnboundedSender<Event>,
    session_id: &str,
) -> usize {
    let mut emitted = 0usize;
    let mut skipped = 0usize;

    for bitmap_data in &bitmap_update.rectangles {
        let rect = &bitmap_data.rectangle;
        let bpp = bitmap_data.bits_per_pixel as usize;
        // Dimensões codificadas no bitmap (podem ser maiores que o rect visível por padding)
        let encoded_width = bitmap_data.width as usize;
        let encoded_height = bitmap_data.height as usize;
        // Dimensões visíveis do retângulo de destino
        let visible_width = (rect.right.saturating_sub(rect.left) + 1) as usize;
        let visible_height = (rect.bottom.saturating_sub(rect.top) + 1) as usize;
        let data_len = bitmap_data.bitmap_data.len();
        let expected_raw = encoded_width * encoded_height * (bpp / 8);
        let flags = bitmap_data.compression_flags;

        debug!(
            "bitmap rect: encoded={}x{} visible={}x{} @ ({},{}) bpp={} flags={:?} data_len={} expected_raw={}",
            encoded_width, encoded_height, visible_width, visible_height,
            rect.left, rect.top, bpp, flags, data_len, expected_raw
        );

        if encoded_width == 0 || encoded_height == 0 || visible_width == 0 || visible_height == 0 {
            skipped += 1;
            continue;
        }

        // Decodificar/descomprimir bitmap para RGBA32, cropando para o rect visível.
        let is_compressed = bitmap_data.compression_flags.contains(Compression::BITMAP_COMPRESSION);

        let rgba_data = if is_compressed && bpp == 32 {
            // Bitmaps comprimidos a 32bpp usam RDP 6.0 Bitmap Compression (codec planar),
            // encapsulados numa RDP 6.0 Bitmap Compressed Stream ([MS-RDPEGDI] 2.2.2.5.1).
            // NÃO é Interleaved RLE — saída do decoder é RGB24 (ordem R,G,B), bottom-up.
            let mut rgb24 = Vec::new();
            match BitmapStreamDecoder::default().decode_bitmap_stream_to_rgb24(
                bitmap_data.bitmap_data,
                &mut rgb24,
                encoded_width,
                encoded_height,
            ) {
                Ok(()) => convert_rgb24_to_rgba(
                    &rgb24,
                    encoded_width,
                    encoded_height,
                    visible_width,
                    visible_height,
                ),
                Err(e) => {
                    debug!("RDP6 planar decode failed (rect {}x{} @ {},{} bpp={}): {:?}",
                        encoded_width, encoded_height, rect.left, rect.top, bpp, e);
                    skipped += 1;
                    continue;
                }
            }
        } else {
            // Não-32bpp comprimido usa Interleaved RLE; uncompressed é raw.
            let rgb_data = if is_compressed {
                let mut decompressed = Vec::new();
                match rle_decompress::decompress(bitmap_data.bitmap_data, &mut decompressed, encoded_width, encoded_height, bpp) {
                    Ok(_pixel_format) => decompressed,
                    Err(e) => {
                        if data_len == expected_raw {
                            bitmap_data.bitmap_data.to_vec()
                        } else {
                            debug!("RLE decompression failed (rect {}x{} @ {},{} bpp={}): {:?}",
                                encoded_width, encoded_height, rect.left, rect.top, bpp, e);
                            skipped += 1;
                            continue;
                        }
                    }
                }
            } else {
                bitmap_data.bitmap_data.to_vec()
            };

            convert_to_rgba(
                &rgb_data,
                bpp,
                encoded_width,
                encoded_height,
                visible_width,
                visible_height,
            )
        };

        // Dimensões reais do output (min entre encoded e visible)
        let out_w = visible_width.min(encoded_width) as u32;
        let out_h = visible_height.min(encoded_height) as u32;

        // Emitir como RGBA raw base64 (mais rápido que JPEG encode/decode por tile).
        // O frontend usa putImageData direto — zero decode overhead.
        let data_b64 = base64::engine::general_purpose::STANDARD.encode(&rgba_data);

        let _ = event_tx.send(Event::Frame {
            session_id: session_id.to_string(),
            x: rect.left,
            y: rect.top,
            width: out_w as u16,
            height: out_h as u16,
            format: "rgba".to_string(),
            data_b64,
        });
        emitted += 1;
    }

    debug!("process_bitmap_update: emitted={}, skipped={}", emitted, skipped);
    emitted
}

/// Converte saída RGB24 do decoder planar RDP6.0 (ordem R,G,B) para RGBA32.
/// O decoder produz rows bottom-up (igual aos bitmaps RDP raw); invertemos para top-down.
/// Cropa para as dimensões visíveis quando o bitmap codificado é maior (padding).
fn convert_rgb24_to_rgba(
    data: &[u8],
    src_width: usize,
    src_height: usize,
    dst_width: usize,
    dst_height: usize,
) -> Vec<u8> {
    let out_w = dst_width.min(src_width);
    let out_h = dst_height.min(src_height);
    let mut rgba = vec![0u8; out_w * out_h * 4];
    let src_stride = src_width * 3;

    for y in 0..out_h {
        let src_row = src_height - 1 - y;
        let src_offset = src_row * src_stride;
        let dst_offset = y * out_w * 4;

        for x in 0..out_w {
            let src_px = src_offset + x * 3;
            let dst_px = dst_offset + x * 4;

            if src_px + 3 > data.len() {
                break;
            }

            rgba[dst_px] = data[src_px];         // R
            rgba[dst_px + 1] = data[src_px + 1]; // G
            rgba[dst_px + 2] = data[src_px + 2]; // B
            rgba[dst_px + 3] = 255;              // A
        }
    }

    rgba
}

/// Converte dados de bitmap (RGB de vários bpp) para RGBA32, cropando para dimensões visíveis.
/// RDP envia bitmap rows de baixo para cima (bottom-up), precisamos inverter.
///
/// `src_width`/`src_height`: dimensões codificadas no bitmap (stride do source)
/// `dst_width`/`dst_height`: dimensões visíveis do destino (pixels que realmente importam)
///
/// Per MS-RDPBCGR: se bitmapWidth > (destRight - destLeft + 1), pixels extras são ignorados.
fn convert_to_rgba(
    data: &[u8],
    bpp: usize,
    src_width: usize,
    src_height: usize,
    dst_width: usize,
    dst_height: usize,
) -> Vec<u8> {
    let out_w = dst_width.min(src_width);
    let out_h = dst_height.min(src_height);
    let mut rgba = vec![0u8; out_w * out_h * 4];
    let bytes_per_pixel = bpp / 8;
    // Row stride no source usa src_width (inclui padding)
    let src_stride = src_width * bytes_per_pixel;

    for y in 0..out_h {
        // RDP bitmap é bottom-up: primeira row no buffer = bottom da imagem
        let src_row = src_height - 1 - y;
        let src_offset = src_row * src_stride;
        let dst_offset = y * out_w * 4;

        for x in 0..out_w {
            let src_px = src_offset + x * bytes_per_pixel;
            let dst_px = dst_offset + x * 4;

            if src_px + bytes_per_pixel > data.len() {
                break;
            }

            match bpp {
                32 => {
                    // BGRX → RGBA
                    rgba[dst_px] = data[src_px + 2];     // R
                    rgba[dst_px + 1] = data[src_px + 1]; // G
                    rgba[dst_px + 2] = data[src_px];     // B
                    rgba[dst_px + 3] = 255;              // A
                }
                24 => {
                    // BGR → RGBA
                    rgba[dst_px] = data[src_px + 2];     // R
                    rgba[dst_px + 1] = data[src_px + 1]; // G
                    rgba[dst_px + 2] = data[src_px];     // B
                    rgba[dst_px + 3] = 255;              // A
                }
                16 => {
                    // RGB565 → RGBA
                    let pixel = u16::from_le_bytes([data[src_px], data[src_px + 1]]);
                    let r = ((pixel >> 11) & 0x1F) as u8;
                    let g = ((pixel >> 5) & 0x3F) as u8;
                    let b = (pixel & 0x1F) as u8;
                    rgba[dst_px] = (r << 3) | (r >> 2);
                    rgba[dst_px + 1] = (g << 2) | (g >> 4);
                    rgba[dst_px + 2] = (b << 3) | (b >> 2);
                    rgba[dst_px + 3] = 255;
                }
                15 => {
                    // RGB555 → RGBA
                    let pixel = u16::from_le_bytes([data[src_px], data[src_px + 1]]);
                    let r = ((pixel >> 10) & 0x1F) as u8;
                    let g = ((pixel >> 5) & 0x1F) as u8;
                    let b = (pixel & 0x1F) as u8;
                    rgba[dst_px] = (r << 3) | (r >> 2);
                    rgba[dst_px + 1] = (g << 3) | (g >> 2);
                    rgba[dst_px + 2] = (b << 3) | (b >> 2);
                    rgba[dst_px + 3] = 255;
                }
                _ => {
                    // Fallback: branco
                    rgba[dst_px] = 255;
                    rgba[dst_px + 1] = 255;
                    rgba[dst_px + 2] = 255;
                    rgba[dst_px + 3] = 255;
                }
            }
        }
    }

    rgba
}


