#include "protocol.h"
#include "cJSON.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>

/* Mutex para serializar escritas no stdout (múltiplas sessões) */
static pthread_mutex_t stdout_mutex = PTHREAD_MUTEX_INITIALIZER;

/* ─── Base64 encode ─────────────────────────────────────────────────────── */

static const char b64_table[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static char* base64_encode(const uint8_t* data, size_t len, size_t* out_len) {
    size_t olen = 4 * ((len + 2) / 3);
    char* out = (char*)malloc(olen + 1);
    if (!out) return NULL;

    size_t i, j;
    for (i = 0, j = 0; i < len;) {
        uint32_t a = i < len ? data[i++] : 0;
        uint32_t b = i < len ? data[i++] : 0;
        uint32_t c = i < len ? data[i++] : 0;
        uint32_t triple = (a << 16) | (b << 8) | c;

        out[j++] = b64_table[(triple >> 18) & 0x3F];
        out[j++] = b64_table[(triple >> 12) & 0x3F];
        out[j++] = b64_table[(triple >> 6) & 0x3F];
        out[j++] = b64_table[triple & 0x3F];
    }

    /* Padding */
    size_t mod = len % 3;
    if (mod == 1) { out[olen - 2] = '='; out[olen - 1] = '='; }
    else if (mod == 2) { out[olen - 1] = '='; }
    out[olen] = '\0';

    if (out_len) *out_len = olen;
    return out;
}

/* ─── Helpers ───────────────────────────────────────────────────────────── */

static void safe_strcpy(char* dst, const char* src, size_t maxlen) {
    if (!src) { dst[0] = '\0'; return; }
    strncpy(dst, src, maxlen - 1);
    dst[maxlen - 1] = '\0';
}

static void emit_json(cJSON* json) {
    char* str = cJSON_PrintUnformatted(json);
    if (!str) return;

    pthread_mutex_lock(&stdout_mutex);
    fprintf(stdout, "%s\n", str);
    fflush(stdout);
    pthread_mutex_unlock(&stdout_mutex);

    free(str);
    cJSON_Delete(json);
}

/* ─── Parse commands (stdin) ────────────────────────────────────────────── */

bool protocol_read_command(Command* cmd) {
    char line[1024 * 1024]; /* 1MB max para clipboard text */
    if (!fgets(line, sizeof(line), stdin)) {
        return false;
    }

    /* Remove trailing newline */
    size_t len = strlen(line);
    if (len > 0 && line[len - 1] == '\n') line[len - 1] = '\0';
    if (len > 1 && line[len - 2] == '\r') line[len - 2] = '\0';

    cJSON* json = cJSON_Parse(line);
    if (!json) {
        cmd->type = CMD_UNKNOWN;
        return true;
    }

    memset(cmd, 0, sizeof(Command));

    cJSON* type_item = cJSON_GetObjectItem(json, "type");
    const char* type_str = cJSON_GetStringValue(type_item);
    if (!type_str) { cmd->type = CMD_UNKNOWN; cJSON_Delete(json); return true; }

    cJSON* sid = cJSON_GetObjectItem(json, "session_id");
    safe_strcpy(cmd->session_id, cJSON_GetStringValue(sid), sizeof(cmd->session_id));

    if (strcmp(type_str, "connect") == 0) {
        cmd->type = CMD_CONNECT;
        safe_strcpy(cmd->connect.host, cJSON_GetStringValue(cJSON_GetObjectItem(json, "host")), sizeof(cmd->connect.host));
        cmd->connect.port = (uint16_t)cJSON_GetNumberValue(cJSON_GetObjectItem(json, "port"));
        safe_strcpy(cmd->connect.username, cJSON_GetStringValue(cJSON_GetObjectItem(json, "username")), sizeof(cmd->connect.username));
        safe_strcpy(cmd->connect.password, cJSON_GetStringValue(cJSON_GetObjectItem(json, "password")), sizeof(cmd->connect.password));
        safe_strcpy(cmd->connect.domain, cJSON_GetStringValue(cJSON_GetObjectItem(json, "domain")), sizeof(cmd->connect.domain));
        cmd->connect.width = (uint32_t)cJSON_GetNumberValue(cJSON_GetObjectItem(json, "width"));
        cmd->connect.height = (uint32_t)cJSON_GetNumberValue(cJSON_GetObjectItem(json, "height"));

        cJSON* tls = cJSON_GetObjectItem(json, "use_tls");
        cmd->connect.use_tls = tls ? cJSON_IsTrue(tls) : true;
        cJSON* nla = cJSON_GetObjectItem(json, "use_nla");
        cmd->connect.use_nla = nla ? cJSON_IsTrue(nla) : false;

    } else if (strcmp(type_str, "disconnect") == 0) {
        cmd->type = CMD_DISCONNECT;

    } else if (strcmp(type_str, "mouse") == 0) {
        cmd->type = CMD_MOUSE;
        cmd->mouse.x = (uint32_t)cJSON_GetNumberValue(cJSON_GetObjectItem(json, "x"));
        cmd->mouse.y = (uint32_t)cJSON_GetNumberValue(cJSON_GetObjectItem(json, "y"));
        cmd->mouse.flags = (uint32_t)cJSON_GetNumberValue(cJSON_GetObjectItem(json, "flags"));
        cmd->mouse.button = (uint32_t)cJSON_GetNumberValue(cJSON_GetObjectItem(json, "button"));

    } else if (strcmp(type_str, "key") == 0) {
        cmd->type = CMD_KEY;
        cmd->key.scancode = (uint32_t)cJSON_GetNumberValue(cJSON_GetObjectItem(json, "scancode"));
        cJSON* pressed = cJSON_GetObjectItem(json, "is_pressed");
        cmd->key.is_pressed = pressed ? cJSON_IsTrue(pressed) : true;
        cJSON* extended = cJSON_GetObjectItem(json, "is_extended");
        cmd->key.is_extended = extended ? cJSON_IsTrue(extended) : false;

    } else if (strcmp(type_str, "unicode") == 0) {
        cmd->type = CMD_UNICODE;
        cmd->unicode.code_point = (uint32_t)cJSON_GetNumberValue(cJSON_GetObjectItem(json, "code_point"));
        cJSON* pressed = cJSON_GetObjectItem(json, "is_pressed");
        cmd->unicode.is_pressed = pressed ? cJSON_IsTrue(pressed) : true;

    } else if (strcmp(type_str, "clipboard") == 0) {
        cmd->type = CMD_CLIPBOARD;
        const char* text = cJSON_GetStringValue(cJSON_GetObjectItem(json, "text"));
        cmd->clipboard.text = text ? strdup(text) : NULL;

    } else if (strcmp(type_str, "resize") == 0) {
        cmd->type = CMD_RESIZE;
        cmd->resize.width = (uint32_t)cJSON_GetNumberValue(cJSON_GetObjectItem(json, "width"));
        cmd->resize.height = (uint32_t)cJSON_GetNumberValue(cJSON_GetObjectItem(json, "height"));

    } else {
        cmd->type = CMD_UNKNOWN;
    }

    cJSON_Delete(json);
    return true;
}

void protocol_free_command(Command* cmd) {
    if (cmd->type == CMD_CLIPBOARD && cmd->clipboard.text) {
        free(cmd->clipboard.text);
        cmd->clipboard.text = NULL;
    }
}

/* ─── Emit events (stdout) ──────────────────────────────────────────────── */

void protocol_emit_connected(const char* session_id, uint32_t width, uint32_t height) {
    cJSON* j = cJSON_CreateObject();
    cJSON_AddStringToObject(j, "type", "connected");
    cJSON_AddStringToObject(j, "session_id", session_id);
    cJSON_AddNumberToObject(j, "width", width);
    cJSON_AddNumberToObject(j, "height", height);
    emit_json(j);
}

void protocol_emit_frame(const char* session_id, uint32_t x, uint32_t y,
                         uint32_t width, uint32_t height,
                         const uint8_t* rgba_data, size_t data_len) {
    size_t b64_len = 0;
    char* b64 = base64_encode(rgba_data, data_len, &b64_len);
    if (!b64) return;

    cJSON* j = cJSON_CreateObject();
    cJSON_AddStringToObject(j, "type", "frame");
    cJSON_AddStringToObject(j, "session_id", session_id);
    cJSON_AddNumberToObject(j, "x", x);
    cJSON_AddNumberToObject(j, "y", y);
    cJSON_AddNumberToObject(j, "width", width);
    cJSON_AddNumberToObject(j, "height", height);
    cJSON_AddStringToObject(j, "format", "rgba");
    cJSON_AddStringToObject(j, "data_b64", b64);
    emit_json(j);

    free(b64);
}

void protocol_emit_disconnected(const char* session_id, const char* reason) {
    cJSON* j = cJSON_CreateObject();
    cJSON_AddStringToObject(j, "type", "disconnected");
    cJSON_AddStringToObject(j, "session_id", session_id);
    cJSON_AddStringToObject(j, "reason", reason ? reason : "");
    emit_json(j);
}

void protocol_emit_error(const char* message) {
    cJSON* j = cJSON_CreateObject();
    cJSON_AddStringToObject(j, "type", "error");
    cJSON_AddStringToObject(j, "message", message ? message : "unknown error");
    emit_json(j);
}

void protocol_emit_clipboard(const char* session_id, const char* text) {
    cJSON* j = cJSON_CreateObject();
    cJSON_AddStringToObject(j, "type", "clipboard_received");
    cJSON_AddStringToObject(j, "session_id", session_id);
    cJSON_AddStringToObject(j, "text", text ? text : "");
    emit_json(j);
}

void protocol_emit_resolution(const char* session_id, uint32_t width, uint32_t height) {
    cJSON* j = cJSON_CreateObject();
    cJSON_AddStringToObject(j, "type", "resolution");
    cJSON_AddStringToObject(j, "session_id", session_id);
    cJSON_AddNumberToObject(j, "width", width);
    cJSON_AddNumberToObject(j, "height", height);
    emit_json(j);
}
