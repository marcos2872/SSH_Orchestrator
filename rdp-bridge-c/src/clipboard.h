#ifndef CLIPBOARD_H
#define CLIPBOARD_H

#include "session.h"

/**
 * Chamado quando o canal Clipboard conecta.
 */
void clipboard_on_channel_connected(BridgeContext* ctx, CliprdrClientContext* cliprdr);

/**
 * Chamado quando o canal Clipboard desconecta.
 */
void clipboard_on_channel_disconnected(BridgeContext* ctx);

/**
 * Envia texto para o clipboard remoto.
 */
bool clipboard_send_text(BridgeContext* ctx, const char* text);

#endif /* CLIPBOARD_H */
