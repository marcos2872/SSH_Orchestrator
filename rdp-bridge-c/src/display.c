#include "display.h"
#include "protocol.h"

#include <freerdp/channels/disp.h>
#include <string.h>

void display_on_channel_connected(BridgeContext* ctx, DispClientContext* disp) {
    ctx->disp = disp;
    ctx->disp_ready = true;
    disp->custom = ctx;

    fprintf(stderr, "[rdp-bridge] Display Control channel connected (session %s)\n",
            ctx->session_id);

    /* Se havia um resize pendente, enviar agora */
    if (ctx->pending_resize_w > 0 && ctx->pending_resize_h > 0) {
        display_send_resize(ctx, ctx->pending_resize_w, ctx->pending_resize_h);
        ctx->pending_resize_w = 0;
        ctx->pending_resize_h = 0;
    }
}

void display_on_channel_disconnected(BridgeContext* ctx) {
    ctx->disp = NULL;
    ctx->disp_ready = false;
    fprintf(stderr, "[rdp-bridge] Display Control channel disconnected (session %s)\n",
            ctx->session_id);
}

bool display_send_resize(BridgeContext* ctx, uint32_t width, uint32_t height) {
    if (!ctx->disp || !ctx->disp_ready) {
        /* Canal ainda não conectou; guardar como pendente */
        ctx->pending_resize_w = width;
        ctx->pending_resize_h = height;
        fprintf(stderr, "[rdp-bridge] Resize queued (%ux%u), display channel not ready\n",
                width, height);
        return false;
    }

    /* Alinhar width a múltiplo de 2 (requisito do protocolo) */
    if (width % 2 != 0) width++;

    /* Validar limites */
    if (width < DISPLAY_CONTROL_MIN_MONITOR_WIDTH)
        width = DISPLAY_CONTROL_MIN_MONITOR_WIDTH;
    if (width > DISPLAY_CONTROL_MAX_MONITOR_WIDTH)
        width = DISPLAY_CONTROL_MAX_MONITOR_WIDTH;
    if (height < DISPLAY_CONTROL_MIN_MONITOR_HEIGHT)
        height = DISPLAY_CONTROL_MIN_MONITOR_HEIGHT;
    if (height > DISPLAY_CONTROL_MAX_MONITOR_HEIGHT)
        height = DISPLAY_CONTROL_MAX_MONITOR_HEIGHT;

    DISPLAY_CONTROL_MONITOR_LAYOUT layout = {0};
    layout.Flags = DISPLAY_CONTROL_MONITOR_PRIMARY;
    layout.Left = 0;
    layout.Top = 0;
    layout.Width = width;
    layout.Height = height;
    layout.Orientation = ORIENTATION_LANDSCAPE;
    layout.DesktopScaleFactor = 100;
    layout.DeviceScaleFactor = 100;
    layout.PhysicalWidth = 0;
    layout.PhysicalHeight = 0;

    UINT rc = ctx->disp->SendMonitorLayout(ctx->disp, 1, &layout);
    if (rc != 0) {
        fprintf(stderr, "[rdp-bridge] SendMonitorLayout failed: 0x%08X\n", rc);
        return false;
    }

    fprintf(stderr, "[rdp-bridge] Resize sent: %ux%u (session %s)\n",
            width, height, ctx->session_id);
    return true;
}
