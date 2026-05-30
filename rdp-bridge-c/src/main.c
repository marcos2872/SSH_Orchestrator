#include "protocol.h"
#include "session.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <unistd.h>

static volatile int g_running = 1;

static void signal_handler(int sig) {
    (void)sig;
    g_running = 0;
}

int main(int argc, char* argv[]) {
    (void)argc;
    (void)argv;

    /* Ignorar SIGPIPE (stdout pode fechar se o processo pai morrer) */
    signal(SIGPIPE, SIG_IGN);
    signal(SIGINT, signal_handler);
    signal(SIGTERM, signal_handler);

    /* Desabilitar buffering no stderr (logs imediatos) */
    setvbuf(stderr, NULL, _IONBF, 0);

    /* Forçar WinPR/FreeRDP a logar em /dev/stderr via file appender
     * (evita poluir stdout que é reservado para o protocolo JSON) */
    setenv("WLOG_APPENDER", "file", 1);
    setenv("WLOG_FILEAPPENDER_OUTPUT_FILE_PATH", "/dev/stderr", 1);
    setenv("WLOG_FILEAPPENDER_OUTPUT_FILE_NAME", "rdp-bridge.log", 1);

    fprintf(stderr, "[rdp-bridge] FreeRDP sidecar started (pid=%d)\n", getpid());

    /* Loop principal: ler comandos do stdin */
    Command cmd;
    while (g_running) {
        if (!protocol_read_command(&cmd)) {
            /* EOF no stdin = processo pai morreu */
            fprintf(stderr, "[rdp-bridge] stdin EOF, shutting down\n");
            break;
        }

        switch (cmd.type) {
            case CMD_CONNECT:
                session_start(&cmd);
                break;

            case CMD_DISCONNECT:
                session_disconnect(cmd.session_id);
                break;

            case CMD_MOUSE:
            case CMD_KEY:
            case CMD_UNICODE:
            case CMD_CLIPBOARD:
            case CMD_RESIZE:
                session_send_input(cmd.session_id, &cmd);
                break;

            case CMD_UNKNOWN:
            default:
                fprintf(stderr, "[rdp-bridge] Unknown command received\n");
                break;
        }

        protocol_free_command(&cmd);
    }

    /* Cleanup */
    session_disconnect_all();
    fprintf(stderr, "[rdp-bridge] Shutdown complete\n");
    return 0;
}
