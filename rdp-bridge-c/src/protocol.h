#ifndef PROTOCOL_H
#define PROTOCOL_H

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>

/* Tipos de comando recebidos via stdin (JSON) */
typedef enum {
    CMD_CONNECT,
    CMD_DISCONNECT,
    CMD_MOUSE,
    CMD_KEY,
    CMD_UNICODE,
    CMD_CLIPBOARD,
    CMD_RESIZE,
    CMD_UNKNOWN
} CommandType;

/* Comando parseado */
typedef struct {
    CommandType type;
    char session_id[64];

    union {
        struct {
            char host[256];
            uint16_t port;
            char username[128];
            char password[256];
            char domain[128];
            uint32_t width;
            uint32_t height;
            bool use_tls;
            bool use_nla;
        } connect;

        struct {
            uint32_t x;
            uint32_t y;
            uint32_t flags;
            uint32_t button;
        } mouse;

        struct {
            uint32_t scancode;
            bool is_pressed;
            bool is_extended;
        } key;

        struct {
            uint32_t code_point;
            bool is_pressed;
        } unicode;

        struct {
            char* text; /* heap-allocated, caller must free */
        } clipboard;

        struct {
            uint32_t width;
            uint32_t height;
        } resize;
    };
} Command;

/* Funções de protocolo */

/**
 * Lê uma linha do stdin e parseia como Command.
 * Retorna true se parseou com sucesso, false em EOF ou erro.
 */
bool protocol_read_command(Command* cmd);

/**
 * Libera recursos alocados por um Command (ex: clipboard.text).
 */
void protocol_free_command(Command* cmd);

/**
 * Emite evento "connected" no stdout.
 */
void protocol_emit_connected(const char* session_id, uint32_t width, uint32_t height);

/**
 * Emite evento "frame" no stdout.
 * data é raw RGBA, será codificado em base64 internamente.
 */
void protocol_emit_frame(const char* session_id, uint32_t x, uint32_t y,
                         uint32_t width, uint32_t height,
                         const uint8_t* rgba_data, size_t data_len);

/**
 * Emite evento "disconnected" no stdout.
 */
void protocol_emit_disconnected(const char* session_id, const char* reason);

/**
 * Emite evento "error" no stdout.
 */
void protocol_emit_error(const char* message);

/**
 * Emite evento "clipboard_received" no stdout.
 */
void protocol_emit_clipboard(const char* session_id, const char* text);

/**
 * Emite evento "resolution" no stdout (após resize bem-sucedido).
 */
void protocol_emit_resolution(const char* session_id, uint32_t width, uint32_t height);

#endif /* PROTOCOL_H */
