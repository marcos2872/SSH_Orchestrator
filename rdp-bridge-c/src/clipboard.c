#include "clipboard.h"
#include "protocol.h"

#include <freerdp/client/cliprdr.h>
#include <freerdp/channels/cliprdr.h>

#include <winpr/crt.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>

/* ─── Callbacks do canal clipboard ──────────────────────────────────────── */

static UINT cb_monitor_ready(CliprdrClientContext* cliprdr,
                              const CLIPRDR_MONITOR_READY* monitorReady) {
    (void)monitorReady;
    BridgeContext* ctx = (BridgeContext*)cliprdr->custom;

    /* Enviar capabilities */
    CLIPRDR_CAPABILITIES caps = {0};
    CLIPRDR_GENERAL_CAPABILITY_SET general = {0};
    caps.cCapabilitiesSets = 1;
    caps.capabilitySets = (CLIPRDR_CAPABILITY_SET*)&general;
    general.capabilitySetType = CB_CAPSTYPE_GENERAL;
    general.capabilitySetLength = 12;
    general.generalFlags = CB_USE_LONG_FORMAT_NAMES;

    UINT rc = cliprdr->ClientCapabilities(cliprdr, &caps);
    if (rc != 0) return rc;

    /* Anunciar que suportamos texto Unicode */
    CLIPRDR_FORMAT_LIST formatList = {0};
    CLIPRDR_FORMAT formats[1] = {0};
    formats[0].formatId = CF_UNICODETEXT;
    formats[0].formatName = NULL;
    formatList.numFormats = 1;
    formatList.formats = formats;

    return cliprdr->ClientFormatList(cliprdr, &formatList);
}

static UINT cb_server_format_list(CliprdrClientContext* cliprdr,
                                   const CLIPRDR_FORMAT_LIST* formatList) {
    BridgeContext* ctx = (BridgeContext*)cliprdr->custom;

    /* Responder com FormatListResponse */
    CLIPRDR_FORMAT_LIST_RESPONSE resp = {0};
    resp.common.msgFlags = CB_RESPONSE_OK;
    UINT rc = cliprdr->ClientFormatListResponse(cliprdr, &resp);
    if (rc != 0) return rc;

    /* Verificar se server tem CF_UNICODETEXT e pedir */
    for (UINT32 i = 0; i < formatList->numFormats; i++) {
        if (formatList->formats[i].formatId == CF_UNICODETEXT) {
            CLIPRDR_FORMAT_DATA_REQUEST req = {0};
            req.requestedFormatId = CF_UNICODETEXT;
            return cliprdr->ClientFormatDataRequest(cliprdr, &req);
        }
    }

    return CHANNEL_RC_OK;
}

static UINT cb_server_format_data_request(CliprdrClientContext* cliprdr,
                                           const CLIPRDR_FORMAT_DATA_REQUEST* req) {
    BridgeContext* ctx = (BridgeContext*)cliprdr->custom;

    CLIPRDR_FORMAT_DATA_RESPONSE resp = {0};

    if (req->requestedFormatId == CF_UNICODETEXT && ctx->clipboard_text) {
        /* Converter UTF-8 para UTF-16LE */
        size_t len = strlen(ctx->clipboard_text);
        /* Alocação simples: cada char pode virar até 2 wchars, mais null terminator */
        size_t buf_size = (len + 1) * 2;
        uint8_t* buf = (uint8_t*)calloc(1, buf_size);

        /* Conversão simplificada ASCII→UTF-16LE (funciona para texto latino) */
        size_t out_len = 0;
        for (size_t i = 0; i <= len; i++) {
            buf[out_len++] = (uint8_t)ctx->clipboard_text[i];
            buf[out_len++] = 0;
        }

        resp.common.msgFlags = CB_RESPONSE_OK;
        resp.common.dataLen = (UINT32)out_len;
        resp.requestedFormatData = buf;
        UINT rc = cliprdr->ClientFormatDataResponse(cliprdr, &resp);
        free(buf);
        return rc;
    }

    /* Formato não suportado */
    resp.common.msgFlags = CB_RESPONSE_FAIL;
    return cliprdr->ClientFormatDataResponse(cliprdr, &resp);
}

static UINT cb_server_format_data_response(CliprdrClientContext* cliprdr,
                                            const CLIPRDR_FORMAT_DATA_RESPONSE* resp) {
    BridgeContext* ctx = (BridgeContext*)cliprdr->custom;

    if (resp->common.msgFlags != CB_RESPONSE_OK || !resp->requestedFormatData)
        return CHANNEL_RC_OK;

    /* Converter UTF-16LE para UTF-8 (simplificado para ASCII/Latin) */
    UINT32 data_len = resp->common.dataLen;
    size_t chars = data_len / 2;
    char* text = (char*)calloc(1, chars + 1);
    if (!text) return CHANNEL_RC_OK;

    for (size_t i = 0; i < chars; i++) {
        uint16_t wc = resp->requestedFormatData[i * 2] |
                      ((uint16_t)resp->requestedFormatData[i * 2 + 1] << 8);
        if (wc == 0) break;
        text[i] = (wc < 128) ? (char)wc : '?';
    }

    protocol_emit_clipboard(ctx->session_id, text);
    free(text);
    return CHANNEL_RC_OK;
}

/* ─── Public API ────────────────────────────────────────────────────────── */

void clipboard_on_channel_connected(BridgeContext* ctx, CliprdrClientContext* cliprdr) {
    ctx->cliprdr = cliprdr;
    cliprdr->custom = ctx;

    cliprdr->MonitorReady = cb_monitor_ready;
    cliprdr->ServerFormatList = cb_server_format_list;
    cliprdr->ServerFormatDataRequest = cb_server_format_data_request;
    cliprdr->ServerFormatDataResponse = cb_server_format_data_response;

    fprintf(stderr, "[rdp-bridge] Clipboard channel connected (session %s)\n",
            ctx->session_id);
}

void clipboard_on_channel_disconnected(BridgeContext* ctx) {
    ctx->cliprdr = NULL;
    fprintf(stderr, "[rdp-bridge] Clipboard channel disconnected (session %s)\n",
            ctx->session_id);
}

bool clipboard_send_text(BridgeContext* ctx, const char* text) {
    if (!ctx->cliprdr || !text) return false;

    /* Guardar texto local para responder ServerFormatDataRequest */
    if (ctx->clipboard_text) free(ctx->clipboard_text);
    ctx->clipboard_text = strdup(text);

    /* Anunciar ao server que temos conteúdo novo */
    CLIPRDR_FORMAT_LIST formatList = {0};
    CLIPRDR_FORMAT formats[1] = {0};
    formats[0].formatId = CF_UNICODETEXT;
    formats[0].formatName = NULL;
    formatList.numFormats = 1;
    formatList.formats = formats;

    UINT rc = ctx->cliprdr->ClientFormatList(ctx->cliprdr, &formatList);
    return (rc == 0);
}
