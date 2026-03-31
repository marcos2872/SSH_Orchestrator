import React, { useEffect, useImperativeHandle, useRef, useState } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { ptySpawn, ptyWrite, ptyResize, ptyKill } from "../../lib/api/pty";
import { Terminal as XTerm, IDisposable } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import { getTheme } from "../../lib/themes";

export interface LocalTerminalRef {
  fit: () => void;
}

interface Props {
  onClose: () => void;
  themeId?: string;
  isActive?: boolean;
}

type ConnectionState = "spawning" | "connected" | "exited";

const LocalTerminal = React.forwardRef<LocalTerminalRef, Props>(
  ({ onClose, themeId = "dark-default" }, ref) => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<XTerm | null>(null);
    const fitRef = useRef<FitAddon | null>(null);

    const sessionIdRef = useRef<string | null>(null);
    const unlistenDataRef = useRef<UnlistenFn | null>(null);
    const unlistenCloseRef = useRef<UnlistenFn | null>(null);
    const onDataDisposableRef = useRef<IDisposable | null>(null);
    const onResizeDisposableRef = useRef<IDisposable | null>(null);

    const [connState, setConnState] = useState<ConnectionState>("spawning");

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

      // ── Forward keystrokes to local PTY ─────────────────────────────────
      onDataDisposableRef.current = term.onData((data) => {
        const sid = sessionIdRef.current;
        if (!sid) return;
        const encoded = btoa(
          Array.from(new TextEncoder().encode(data))
            .map((b) => String.fromCharCode(b))
            .join(""),
        );
        ptyWrite(sid, encoded).catch(() => {});
      });

      // ── Resize: notify local PTY when xterm dimensions change ───────────
      let resizeTimer: ReturnType<typeof setTimeout> | null = null;
      onResizeDisposableRef.current = term.onResize(({ cols, rows }) => {
        const sid = sessionIdRef.current;
        if (!sid) return;
        // Debounce resize events to avoid flooding during drag resize
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          ptyResize(sid, cols, rows).catch(() => {});
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

    // ── Spawn local shell on mount ────────────────────────────────────────────
    useEffect(() => {
      const timer = setTimeout(() => {
        spawnShell();
      }, 150);
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

    // ── Helpers ───────────────────────────────────────────────────────────────
    const cleanupSession = async () => {
      unlistenDataRef.current?.();
      unlistenCloseRef.current?.();
      unlistenDataRef.current = null;
      unlistenCloseRef.current = null;
      if (sessionIdRef.current) {
        await ptyKill(sessionIdRef.current).catch(() => {});
        sessionIdRef.current = null;
      }
    };

    const spawnShell = async () => {
      const term = xtermRef.current;
      setConnState("spawning");

      try {
        const sessionId = crypto.randomUUID();
        sessionIdRef.current = sessionId;

        // Listen for PTY output
        unlistenDataRef.current = await listen<string>(
          `pty://data/${sessionId}`,
          (event) => {
            const bytes = Uint8Array.from(atob(event.payload), (c) =>
              c.charCodeAt(0),
            );
            xtermRef.current?.write(bytes);
          },
        );

        // Listen for PTY close (shell exited)
        unlistenCloseRef.current = await listen(
          `pty://close/${sessionId}`,
          () => {
            xtermRef.current?.writeln("\r\n\x1b[33m[Shell encerrado]\x1b[0m");
            setConnState("exited");
          },
        );

        // Pass the current xterm dimensions so the PTY starts at the correct size
        const cols = term?.cols ?? 80;
        const rows = term?.rows ?? 24;
        await ptySpawn(sessionId, cols, rows);

        setConnState("connected");
        xtermRef.current?.focus();
      } catch (err) {
        term?.writeln(
          `\x1b[1;31m[✗] Erro ao abrir terminal: ${String(err)}\x1b[0m`,
        );
        setConnState("exited");
      }
    };

    const handleClose = async () => {
      await cleanupSession();
      onClose();
    };

    const handleRestart = async () => {
      await cleanupSession();
      spawnShell();
    };

    return (
      <div className="flex flex-col h-full w-full relative" style={{ background: "#000000" }}>
        {/* Exited / reconnect */}
        {connState === "exited" && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex gap-3">
            <button
              onClick={handleRestart}
              className="px-5 py-2 text-sm font-semibold rounded-xl transition-all active:scale-[0.98]"
              style={{
                background: "#32d74b",
                color: "#000000",
                boxShadow: "0 4px 16px rgba(50,215,75,0.35)",
              }}
            >
              Reabrir
            </button>
            <button
              onClick={handleClose}
              className="px-5 py-2 text-sm font-semibold rounded-xl transition-all active:scale-[0.98]"
              style={{
                background: "rgba(255,255,255,0.1)",
                color: "rgba(255,255,255,0.8)",
                backdropFilter: "blur(10px)",
              }}
            >
              Fechar
            </button>
          </div>
        )}

        {/* xterm container */}
        <div className="flex-1 min-h-0 relative overflow-hidden flex flex-col">
          <div className="flex-1 overflow-hidden relative w-full h-full">
            <div ref={terminalRef} className="h-full w-full" />
          </div>
        </div>
      </div>
    );
  },
);

LocalTerminal.displayName = "LocalTerminal";
export default LocalTerminal;
