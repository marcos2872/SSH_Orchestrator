#ifndef SESSION_H
#define SESSION_H

#include "protocol.h"

#include <freerdp/freerdp.h>
#include <freerdp/client.h>
#include <freerdp/gdi/gdi.h>
#include <freerdp/client/cliprdr.h>
#include <freerdp/client/disp.h>
#include <freerdp/channels/channels.h>

#include <pthread.h>
#include <stdbool.h>

#define MAX_SESSIONS 16

/* Contexto customizado por sessão */
typedef struct {
    rdpClientContext common;

    char session_id[64];
    bool running;

    /* Display Control */
    DispClientContext* disp;
    bool disp_ready;
    uint32_t pending_resize_w;
    uint32_t pending_resize_h;

    /* Clipboard */
    CliprdrClientContext* cliprdr;
    char* clipboard_text;  /* último texto recebido do host */

    /* Input queue (thread-safe) */
    pthread_mutex_t input_mutex;
    Command input_queue[256];
    int input_head;
    int input_tail;

} BridgeContext;

/**
 * Cria e inicia uma sessão RDP em thread separada.
 */
bool session_start(const Command* connect_cmd);

/**
 * Envia um comando de input para a sessão especificada.
 */
bool session_send_input(const char* session_id, const Command* cmd);

/**
 * Desconecta uma sessão.
 */
bool session_disconnect(const char* session_id);

/**
 * Desconecta todas as sessões ativas.
 */
void session_disconnect_all(void);

#endif /* SESSION_H */
