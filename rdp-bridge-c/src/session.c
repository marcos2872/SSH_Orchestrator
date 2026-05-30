#include "session.h"
#include "display.h"
#include "clipboard.h"
#include "protocol.h"

#include <freerdp/freerdp.h>
#include <freerdp/gdi/gdi.h>
#include <freerdp/gdi/gfx.h>
#include <freerdp/client.h>
#include <freerdp/client/channels.h>
#include <freerdp/channels/channels.h>
#include <freerdp/constants.h>
#include <freerdp/settings.h>
#include <freerdp/event.h>

#include <winpr/assert.h>
#include <winpr/synch.h>
#include <winpr/thread.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>

/* ─── Sessões ativas ────────────────────────────────────────────────────── */

typedef struct {
    BridgeContext* ctx;
    pthread_t thread;
    bool active;
} SessionSlot;

static SessionSlot sessions[MAX_SESSIONS];
static pthread_mutex_t sessions_mutex = PTHREAD_MUTEX_INITIALIZER;

static SessionSlot* find_session(const char* session_id) {
    for (int i = 0; i < MAX_SESSIONS; i++) {
        if (sessions[i].active && sessions[i].ctx &&
            strcmp(sessions[i].ctx->session_id, session_id) == 0) {
            return &sessions[i];
        }
    }
    return NULL;
}

/* ─── Input queue ───────────────────────────────────────────────────────── */

static void input_queue_push(BridgeContext* ctx, const Command* cmd) {
    pthread_mutex_lock(&ctx->input_mutex);
    int next = (ctx->input_head + 1) % 256;
    if (next != ctx->input_tail) {
        ctx->input_queue[ctx->input_head] = *cmd;
        ctx->input_head = next;
    }
    pthread_mutex_unlock(&ctx->input_mutex);
}

static bool input_queue_pop(BridgeContext* ctx, Command* cmd) {
    pthread_mutex_lock(&ctx->input_mutex);
    if (ctx->input_tail == ctx->input_head) {
        pthread_mutex_unlock(&ctx->input_mutex);
        return false;
    }
    *cmd = ctx->input_queue[ctx->input_tail];
    ctx->input_tail = (ctx->input_tail + 1) % 256;
    pthread_mutex_unlock(&ctx->input_mutex);
    return true;
}

/* ─── FreeRDP Callbacks ─────────────────────────────────────────────────── */

static BOOL cb_begin_paint(rdpContext* context) {
    rdpGdi* gdi = context->gdi;
    WINPR_ASSERT(gdi);
    WINPR_ASSERT(gdi->primary);
    WINPR_ASSERT(gdi->primary->hdc);
    WINPR_ASSERT(gdi->primary->hdc->hwnd);
    WINPR_ASSERT(gdi->primary->hdc->hwnd->invalid);
    gdi->primary->hdc->hwnd->invalid->null = TRUE;
    return TRUE;
}

static BOOL cb_end_paint(rdpContext* context) {
    BridgeContext* bctx = (BridgeContext*)context;
    rdpGdi* gdi = context->gdi;
    WINPR_ASSERT(gdi);
    WINPR_ASSERT(gdi->primary);

    HGDI_DC hdc = gdi->primary->hdc;
    if (!hdc || !hdc->hwnd)
        return TRUE;

    HGDI_WND hwnd = hdc->hwnd;
    if (hwnd->invalid->null)
        return TRUE;

    /* Extrair bounding box do dirty rect */
    INT32 x = hwnd->invalid->x;
    INT32 y = hwnd->invalid->y;
    INT32 w = hwnd->invalid->w;
    INT32 h = hwnd->invalid->h;

    if (w <= 0 || h <= 0)
        return TRUE;

    /* Clampar aos limites do framebuffer */
    if (x < 0) { w += x; x = 0; }
    if (y < 0) { h += y; y = 0; }
    if (x + w > gdi->width) w = gdi->width - x;
    if (y + h > gdi->height) h = gdi->height - y;
    if (w <= 0 || h <= 0)
        return TRUE;

    /* Extrair pixels da região dirty (RGBA32) */
    uint32_t stride = (uint32_t)gdi->stride;
    size_t row_bytes = (size_t)w * 4;
    size_t total = row_bytes * (size_t)h;
    uint8_t* buf = (uint8_t*)malloc(total);
    if (!buf)
        return TRUE;

    uint8_t* src = gdi->primary_buffer + (uint32_t)y * stride + (uint32_t)x * 4;
    for (INT32 row = 0; row < h; row++) {
        memcpy(buf + row * row_bytes, src + row * stride, row_bytes);
    }

    /* Emitir frame via protocolo */
    protocol_emit_frame(bctx->session_id, (uint32_t)x, (uint32_t)y,
                        (uint32_t)w, (uint32_t)h, buf, total);
    free(buf);
    return TRUE;
}

static BOOL cb_desktop_resize(rdpContext* context) {
    BridgeContext* bctx = (BridgeContext*)context;
    rdpGdi* gdi = context->gdi;
    rdpSettings* settings = context->settings;

    UINT32 width = freerdp_settings_get_uint32(settings, FreeRDP_DesktopWidth);
    UINT32 height = freerdp_settings_get_uint32(settings, FreeRDP_DesktopHeight);

    if (!gdi_resize(gdi, width, height))
        return FALSE;

    protocol_emit_resolution(bctx->session_id, width, height);
    return TRUE;
}

/* ─── Channel events (PubSub) ───────────────────────────────────────────── */

static void cb_channel_connected(void* context, const ChannelConnectedEventArgs* e) {
    BridgeContext* bctx = (BridgeContext*)context;
    WINPR_ASSERT(bctx);
    WINPR_ASSERT(e);

    if (strcmp(e->name, DISP_DVC_CHANNEL_NAME) == 0) {
        display_on_channel_connected(bctx, (DispClientContext*)e->pInterface);
    } else if (strcmp(e->name, CLIPRDR_SVC_CHANNEL_NAME) == 0) {
        clipboard_on_channel_connected(bctx, (CliprdrClientContext*)e->pInterface);
    } else {
        freerdp_client_OnChannelConnectedEventHandler(&bctx->common, e);
    }
}

static void cb_channel_disconnected(void* context, const ChannelDisconnectedEventArgs* e) {
    BridgeContext* bctx = (BridgeContext*)context;
    WINPR_ASSERT(bctx);
    WINPR_ASSERT(e);

    if (strcmp(e->name, DISP_DVC_CHANNEL_NAME) == 0) {
        display_on_channel_disconnected(bctx);
    } else if (strcmp(e->name, CLIPRDR_SVC_CHANNEL_NAME) == 0) {
        clipboard_on_channel_disconnected(bctx);
    } else {
        freerdp_client_OnChannelDisconnectedEventHandler(&bctx->common, e);
    }
}

/* ─── Pre/Post Connect ──────────────────────────────────────────────────── */

static BOOL cb_pre_connect(freerdp* instance) {
    WINPR_ASSERT(instance);
    rdpContext* context = instance->context;
    WINPR_ASSERT(context);
    rdpSettings* settings = context->settings;
    WINPR_ASSERT(settings);

    /* Habilitar Display Control (resize dinâmico) */
    freerdp_settings_set_bool(settings, FreeRDP_SupportDisplayControl, TRUE);
    freerdp_settings_set_bool(settings, FreeRDP_DynamicResolutionUpdate, TRUE);

    /* OS identifier */
    freerdp_settings_set_uint32(settings, FreeRDP_OsMajorType, OSMAJORTYPE_UNIX);
    freerdp_settings_set_uint32(settings, FreeRDP_OsMinorType, OSMINORTYPE_NATIVE_XSERVER);

    /* Aceitar certificados automaticamente */
    freerdp_settings_set_bool(settings, FreeRDP_CertificateCallbackPreferPEM, TRUE);

    /* Channel event handlers */
    PubSub_SubscribeChannelConnected(context->pubSub, cb_channel_connected);
    PubSub_SubscribeChannelDisconnected(context->pubSub, cb_channel_disconnected);

    return TRUE;
}

static BOOL cb_post_connect(freerdp* instance) {
    WINPR_ASSERT(instance);
    rdpContext* context = instance->context;
    BridgeContext* bctx = (BridgeContext*)context;
    WINPR_ASSERT(context);

    /* Inicializar GDI com RGBA32 (direto para o frontend) */
    if (!gdi_init(instance, PIXEL_FORMAT_RGBA32))
        return FALSE;

    /* Registrar callbacks de pintura */
    WINPR_ASSERT(context->update);
    context->update->BeginPaint = cb_begin_paint;
    context->update->EndPaint = cb_end_paint;
    context->update->DesktopResize = cb_desktop_resize;

    /* Emitir evento "connected" */
    rdpSettings* settings = context->settings;
    UINT32 w = freerdp_settings_get_uint32(settings, FreeRDP_DesktopWidth);
    UINT32 h = freerdp_settings_get_uint32(settings, FreeRDP_DesktopHeight);
    protocol_emit_connected(bctx->session_id, w, h);

    return TRUE;
}

static void cb_post_disconnect(freerdp* instance) {
    if (!instance || !instance->context)
        return;

    BridgeContext* bctx = (BridgeContext*)instance->context;

    PubSub_UnsubscribeChannelConnected(instance->context->pubSub, cb_channel_connected);
    PubSub_UnsubscribeChannelDisconnected(instance->context->pubSub, cb_channel_disconnected);

    gdi_free(instance);
    protocol_emit_disconnected(bctx->session_id, "session ended");
}

/* ─── Certificate verification (auto-accept) ───────────────────────────── */

static DWORD cb_verify_certificate_ex(freerdp* instance, const char* host, UINT16 port,
                                       const char* common_name, const char* subject,
                                       const char* issuer, const char* fingerprint,
                                       DWORD flags) {
    (void)instance; (void)host; (void)port; (void)common_name;
    (void)subject; (void)issuer; (void)fingerprint; (void)flags;
    return 1; /* accept */
}

static DWORD cb_verify_changed_certificate_ex(freerdp* instance, const char* host, UINT16 port,
                                               const char* common_name, const char* subject,
                                               const char* issuer, const char* new_fingerprint,
                                               const char* old_subject, const char* old_issuer,
                                               const char* old_fingerprint, DWORD flags) {
    (void)instance; (void)host; (void)port; (void)common_name;
    (void)subject; (void)issuer; (void)new_fingerprint;
    (void)old_subject; (void)old_issuer; (void)old_fingerprint; (void)flags;
    return 1; /* accept */
}

/* ─── Process input from queue ──────────────────────────────────────────── */

static void process_input(BridgeContext* bctx) {
    Command cmd;
    freerdp* instance = bctx->common.context.instance;
    rdpInput* input = instance->context->input;

    while (input_queue_pop(bctx, &cmd)) {
        switch (cmd.type) {
            case CMD_MOUSE:
                freerdp_input_send_mouse_event(input, cmd.mouse.flags,
                                               (UINT16)cmd.mouse.x, (UINT16)cmd.mouse.y);
                break;

            case CMD_KEY:
                freerdp_input_send_keyboard_event(input,
                    cmd.key.is_pressed ? KBD_FLAGS_DOWN : KBD_FLAGS_RELEASE,
                    (UINT16)cmd.key.scancode);
                break;

            case CMD_UNICODE:
                freerdp_input_send_unicode_keyboard_event(input,
                    cmd.unicode.is_pressed ? KBD_FLAGS_DOWN : KBD_FLAGS_RELEASE,
                    (UINT16)cmd.unicode.code_point);
                break;

            case CMD_CLIPBOARD:
                clipboard_send_text(bctx, cmd.clipboard.text);
                protocol_free_command(&cmd);
                break;

            case CMD_RESIZE:
                display_send_resize(bctx, cmd.resize.width, cmd.resize.height);
                break;

            case CMD_DISCONNECT:
                bctx->running = false;
                break;

            default:
                break;
        }
    }
}

/* ─── Session thread ────────────────────────────────────────────────────── */

static void* session_thread(void* arg) {
    BridgeContext* bctx = (BridgeContext*)arg;
    freerdp* instance = bctx->common.context.instance;

    BOOL rc = freerdp_connect(instance);
    if (!rc) {
        UINT32 err = freerdp_get_last_error(instance->context);
        char errmsg[256];
        snprintf(errmsg, sizeof(errmsg), "Connection failed (0x%08X)", err);
        protocol_emit_error(errmsg);
        protocol_emit_disconnected(bctx->session_id, errmsg);
        bctx->running = false;
        return NULL;
    }

    /* Main event loop */
    while (bctx->running && !freerdp_shall_disconnect_context(instance->context)) {
        HANDLE handles[MAXIMUM_WAIT_OBJECTS] = {0};
        DWORD nCount = freerdp_get_event_handles(instance->context, handles, ARRAYSIZE(handles));

        if (nCount == 0) {
            fprintf(stderr, "[rdp-bridge] freerdp_get_event_handles failed\n");
            break;
        }

        DWORD status = WaitForMultipleObjects(nCount, handles, FALSE, 16);
        if (status == WAIT_FAILED) {
            fprintf(stderr, "[rdp-bridge] WaitForMultipleObjects failed\n");
            break;
        }

        if (!freerdp_check_event_handles(instance->context)) {
            if (freerdp_get_last_error(instance->context) == FREERDP_ERROR_SUCCESS)
                fprintf(stderr, "[rdp-bridge] check_event_handles failed\n");
            break;
        }

        /* Process pending input commands */
        process_input(bctx);
    }

    freerdp_disconnect(instance);
    bctx->running = false;
    return NULL;
}

/* ─── Client entry points ───────────────────────────────────────────────── */

static BOOL client_new(freerdp* instance, rdpContext* context) {
    WINPR_ASSERT(instance);
    instance->PreConnect = cb_pre_connect;
    instance->PostConnect = cb_post_connect;
    instance->PostDisconnect = cb_post_disconnect;
    instance->VerifyCertificateEx = cb_verify_certificate_ex;
    instance->VerifyChangedCertificateEx = cb_verify_changed_certificate_ex;
    return TRUE;
}

static void client_free(freerdp* instance, rdpContext* context) {
    (void)instance;
    (void)context;
}

/* ─── Public API ────────────────────────────────────────────────────────── */

bool session_start(const Command* connect_cmd) {
    pthread_mutex_lock(&sessions_mutex);

    /* Encontrar slot livre */
    int slot = -1;
    for (int i = 0; i < MAX_SESSIONS; i++) {
        if (!sessions[i].active) { slot = i; break; }
    }
    if (slot < 0) {
        pthread_mutex_unlock(&sessions_mutex);
        protocol_emit_error("max sessions reached");
        return false;
    }

    /* Criar contexto FreeRDP */
    RDP_CLIENT_ENTRY_POINTS entry = {0};
    entry.Version = RDP_CLIENT_INTERFACE_VERSION;
    entry.Size = sizeof(RDP_CLIENT_ENTRY_POINTS);
    entry.ContextSize = sizeof(BridgeContext);
    entry.ClientNew = client_new;
    entry.ClientFree = client_free;

    rdpContext* context = freerdp_client_context_new(&entry);
    if (!context) {
        pthread_mutex_unlock(&sessions_mutex);
        protocol_emit_error("failed to create FreeRDP context");
        return false;
    }

    BridgeContext* bctx = (BridgeContext*)context;
    strncpy(bctx->session_id, connect_cmd->session_id, sizeof(bctx->session_id) - 1);
    bctx->running = true;
    pthread_mutex_init(&bctx->input_mutex, NULL);
    bctx->input_head = 0;
    bctx->input_tail = 0;

    /* Configurar settings */
    rdpSettings* settings = context->settings;
    freerdp_settings_set_string(settings, FreeRDP_ServerHostname, connect_cmd->connect.host);
    freerdp_settings_set_uint32(settings, FreeRDP_ServerPort, connect_cmd->connect.port);
    freerdp_settings_set_string(settings, FreeRDP_Username, connect_cmd->connect.username);
    freerdp_settings_set_string(settings, FreeRDP_Password, connect_cmd->connect.password);
    if (connect_cmd->connect.domain[0])
        freerdp_settings_set_string(settings, FreeRDP_Domain, connect_cmd->connect.domain);

    freerdp_settings_set_uint32(settings, FreeRDP_DesktopWidth, connect_cmd->connect.width);
    freerdp_settings_set_uint32(settings, FreeRDP_DesktopHeight, connect_cmd->connect.height);
    freerdp_settings_set_uint32(settings, FreeRDP_ColorDepth, 32);

    /* Segurança */
    freerdp_settings_set_bool(settings, FreeRDP_NlaSecurity, connect_cmd->connect.use_nla);
    freerdp_settings_set_bool(settings, FreeRDP_TlsSecurity, connect_cmd->connect.use_tls);
    freerdp_settings_set_bool(settings, FreeRDP_RdpSecurity, TRUE);

    /* GFX pipeline (melhor performance com servidores modernos) */
    freerdp_settings_set_bool(settings, FreeRDP_SupportGraphicsPipeline, TRUE);

    /* Registrar na tabela */
    sessions[slot].ctx = bctx;
    sessions[slot].active = true;

    /* Iniciar thread */
    if (pthread_create(&sessions[slot].thread, NULL, session_thread, bctx) != 0) {
        sessions[slot].active = false;
        freerdp_client_context_free(context);
        pthread_mutex_unlock(&sessions_mutex);
        protocol_emit_error("failed to create session thread");
        return false;
    }
    pthread_detach(sessions[slot].thread);

    pthread_mutex_unlock(&sessions_mutex);
    return true;
}

bool session_send_input(const char* session_id, const Command* cmd) {
    pthread_mutex_lock(&sessions_mutex);
    SessionSlot* slot = find_session(session_id);
    if (!slot) {
        pthread_mutex_unlock(&sessions_mutex);
        return false;
    }
    input_queue_push(slot->ctx, cmd);
    pthread_mutex_unlock(&sessions_mutex);
    return true;
}

bool session_disconnect(const char* session_id) {
    pthread_mutex_lock(&sessions_mutex);
    SessionSlot* slot = find_session(session_id);
    if (!slot) {
        pthread_mutex_unlock(&sessions_mutex);
        return false;
    }
    slot->ctx->running = false;
    /* A thread vai detectar running=false e sair do loop */
    /* Cleanup será feito quando a thread terminar */
    pthread_mutex_unlock(&sessions_mutex);
    return true;
}

void session_disconnect_all(void) {
    pthread_mutex_lock(&sessions_mutex);
    for (int i = 0; i < MAX_SESSIONS; i++) {
        if (sessions[i].active && sessions[i].ctx) {
            sessions[i].ctx->running = false;
        }
    }
    pthread_mutex_unlock(&sessions_mutex);
}
