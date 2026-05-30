#ifndef DISPLAY_H
#define DISPLAY_H

#include "session.h"

/**
 * Chamado quando o canal Display Control conecta.
 */
void display_on_channel_connected(BridgeContext* ctx, DispClientContext* disp);

/**
 * Chamado quando o canal Display Control desconecta.
 */
void display_on_channel_disconnected(BridgeContext* ctx);

/**
 * Envia pedido de resize para o servidor.
 */
bool display_send_resize(BridgeContext* ctx, uint32_t width, uint32_t height);

#endif /* DISPLAY_H */
