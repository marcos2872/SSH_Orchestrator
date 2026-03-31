import React, { useEffect, useImperativeHandle, useRef, useState } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import {
  sshConnect,
  sshWrite,
  sshDisconnect,
  sshResize,
} from "../../lib/api/ssh";
import { Terminal as XTerm, IDisposable } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import { getTheme } from "../../lib/themes";
import Modal from "../Modal";

export interface TerminalRef {
  fit: () => void;
}

interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  has_saved_password: boolean;
  has_saved_ssh_key: boolean;
  has_saved_ssh_key_passphrase: boolean;
}

interface Props {
  server: Server;
  onClose: () => void;
  themeId?: string;
  /** Chamado com o SSH session ID (UUID do backend) assim que a conexão for estabelecida */
  onSessionId?: (sessionId: string) => void;
  isActive?: boolean;
}

type ConnectionState =
  | "loading"
  | "prompt"
  | "connecting"
  | "connected"
  | "error";

const Terminal = React.forwardRef<TerminalRef, Props>(
  (
    { server, onClose, themeId = "dark-default", onSessionId, isActive = true },
    ref,
  ) => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<XTerm | null>(null);
    const fitRef = useRef<FitAddon | null>(null);

    const sessionIdRef = useRef<string | null>(null);
    const unlistenDataRef = useRef<UnlistenFn | null>(null);
    const unlistenCloseRef = useRef<UnlistenFn | null>(null);
    const onDataDisposableRef = useRef<IDisposable | null>(null);
    const onResizeDisposableRef = useRef<IDisposable | null>(null);

    const hasSavedCredential = server.has_saved_password || server.has_saved_ssh_key;
    const [connState, setConnState] = useState<ConnectionState>(
      hasSavedCredential ? "loading" : "prompt",
    );
    const [password, setPassword] = useState("");
    const passwordRef = useRef<HTMLInputElement>(null);

    // Expose fit() to parent via ref
    useImperativeHandle(ref, () => ({
      fit: () => fitRef.current?.fit(),
    }));

    // ── xterm init ────────────────────────────────────────────────────────────
    useEffect(() => {
      if (!terminalRef.current) return;
      const { theme } = getTheme(themeId);

      const term = new XTerm({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: '"Fira Code", "Cascadia Code", monospace',
        theme,
      });

      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(terminalRef.current);
      fit.fit();
      xtermRef.current = term;
      fitRef.current = fit;

      onDataDisposableRef.current = term.onData((data) => {
        const sid = sessionIdRef.current;
        if (!sid) return;
        const encoded = btoa(
          Array.from(new TextEncoder().encode(data))
            .map((b) => String.fromCharCode(b))
            .join(""),
        );
        sshWrite(sid, encoded).catch(() => {});
      });

      // ── Resize: notify remote PTY when xterm dimensions change ────────────
      let resizeTimer: ReturnType<typeof setTimeout> | null = null;
      onResizeDisposableRef.current = term.onResize(({ cols, rows }) => {
        const sid = sessionIdRef.current;
        if (!sid) return;
        // Debounce resize events to avoid flooding during drag resize
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          sshResize(sid, cols, rows).catch(() => {});
        }, 100);
      });

      const onResize = () => fit.fit();
      window.addEventListener("resize", onResize);

      return () => {
        window.removeEventListener("resize", onResize);
        if (resizeTimer) clearTimeout(resizeTimer);
        onDataDisposableRef.current?.dispose();
        onResizeDisposableRef.current?.dispose();
        term.dispose();
      };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Theme change: update xterm options live ───────────────────────────────
    useEffect(() => {
      if (!xtermRef.current) return;
      const { theme } = getTheme(themeId);
      xtermRef.current.options.theme = theme;
    }, [themeId]);

    // ── Auto-connect ──────────────────────────────────────────────────────────
    useEffect(() => {
      let timer: ReturnType<typeof setTimeout>;
      if (server.has_saved_password || server.has_saved_ssh_key) {
        // Um pequeno delay evita os problemas do React Strict Mode
        timer = setTimeout(() => {
          connectWithSavedCredential();
        }, 150);
      }
      return () => clearTimeout(timer);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Global cleanup on unmount ─────────────────────────────────────────────
    useEffect(() => {
      return () => {
        cleanupSession();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      if (connState === "prompt" && isActive)
        setTimeout(() => passwordRef.current?.focus(), 50);
    }, [connState, isActive]);

    // ── Helpers ───────────────────────────────────────────────────────────────
    const cleanupSession = async () => {
      unlistenDataRef.current?.();
      unlistenCloseRef.current?.();
      unlistenDataRef.current = null;
      unlistenCloseRef.current = null;
      if (sessionIdRef.current) {
        await sshDisconnect(sessionIdRef.current).catch(() => {});
        sessionIdRef.current = null;
      }
    };

    const connectWithSavedCredential = () => connectWithPassword(null);

    const connectWithPassword = async (pw: string | null) => {
      const term = xtermRef.current;
      setConnState("connecting");
      term?.writeln(
        `\x1b[1;34m[*] Conectando a ${server.username}@${server.host}:${server.port}...\x1b[0m`,
      );
      if (pw === null) {
        if (server.has_saved_ssh_key) {
          term?.writeln("\x1b[2m[Usando chave SSH salva...]\x1b[0m");
        } else if (server.has_saved_password) {
          term?.writeln("\x1b[2m[Usando senha salva...]\x1b[0m");
        }
      }
      try {
        const sessionId = crypto.randomUUID();
        sessionIdRef.current = sessionId;

        unlistenDataRef.current = await listen<string>(
          `ssh://data/${sessionId}`,
          (event) => {
            const bytes = Uint8Array.from(atob(event.payload), (c) =>
              c.charCodeAt(0),
            );
            xtermRef.current?.write(bytes);
          },
        );

        unlistenCloseRef.current = await listen(
          `ssh://close/${sessionId}`,
          () => {
            xtermRef.current?.writeln(
              "\r\n\x1b[33m[Conexão encerrada pelo servidor]\x1b[0m",
            );
            setConnState("error");
          },
        );

        // Pass the current xterm dimensions so the remote PTY starts at the correct size
        const cols = term?.cols ?? 80;
        const rows = term?.rows ?? 24;
        await sshConnect(server.id, pw, sessionId, cols, rows);

        setConnState("connected");
        onSessionId?.(sessionId);
        xtermRef.current?.focus();
      } catch (err) {
        term?.writeln(`\x1b[1;31m[✗] Erro: ${String(err)}\x1b[0m`);
        setConnState("error");
      }
    };

    const handleConnect = () => {
      if (password) connectWithPassword(password);
    };

    const handleClose = async () => {
      await cleanupSession();
      onClose();
    };

    const handleReconnect = async () => {
      setPassword("");
      await cleanupSession();
      if (server.has_saved_password || server.has_saved_ssh_key) {
        setConnState("loading");
        connectWithSavedCredential();
      } else setConnState("prompt");
    };

    return (
      <div className="flex flex-col h-full w-full bg-[#0f172a] relative">
        {/* Password prompt */}
        {connState === "prompt" && isActive && (
          <Modal
            isOpen={true}
            onClose={handleClose}
            title="Autenticação SSH"
            width="w-96"
          >
            <p className="text-sm text-slate-400 font-mono mb-6">
              {server.username}@{server.host}:{server.port}
            </p>
            <div className="mb-4">
              <label className="block text-xs text-slate-500 mb-1">Senha</label>
              <input
                ref={passwordRef}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleConnect();
                }}
                placeholder="••••••••"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <p className="text-xs text-slate-600 mb-4">
              Edite o servidor para salvar uma senha ou chave SSH e conectar sem
              digitar sempre.
            </p>
            <div className="flex gap-3">
              <button
                onClick={handleClose}
                className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-sm font-semibold rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleConnect}
                disabled={!password}
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-sm font-semibold rounded-lg transition-colors"
              >
                Conectar
              </button>
            </div>
          </Modal>
        )}

        {/* Error / reconnect */}
        {connState === "error" && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex gap-3">
            <button
              onClick={handleReconnect}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-sm font-semibold rounded-lg transition-colors shadow-xl"
            >
              Reconectar
            </button>
            <button
              onClick={handleClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-sm font-semibold rounded-lg transition-colors shadow-xl"
            >
              Fechar
            </button>
          </div>
        )}

        {/* xterm container */}
        <div className="flex-1 p-3 pb-4 min-h-0 relative overflow-hidden flex flex-col">
          <div
            className={`flex-1 overflow-hidden relative p-1 border ${connState === "connected" ? "border-green-500/50 w-full h-full" : "border-transparent w-full h-full"}`}
          >
            <div ref={terminalRef} className="h-full w-full" />
          </div>
        </div>
      </div>
    );
  },
);

Terminal.displayName = "Terminal";
export default Terminal;
