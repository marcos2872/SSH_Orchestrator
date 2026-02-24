import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { Terminal as XTerm, IDisposable } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

interface Server {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    has_saved_password: boolean;
}

interface Props {
    server: Server;
    onClose: () => void;
}

type ConnectionState = 'loading' | 'prompt' | 'connecting' | 'connected' | 'error';

const Terminal: React.FC<Props> = ({ server, onClose }) => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<XTerm | null>(null);
    const fitRef = useRef<FitAddon | null>(null);

    // SSH session state — tracked in refs so callbacks always see current values
    const sessionIdRef = useRef<string | null>(null);
    const unlistenDataRef = useRef<UnlistenFn | null>(null);
    const unlistenCloseRef = useRef<UnlistenFn | null>(null);
    // Disposable for the single onData listener registered at xterm init
    const onDataDisposableRef = useRef<IDisposable | null>(null);

    const [connState, setConnState] = useState<ConnectionState>(
        server.has_saved_password ? 'loading' : 'prompt'
    );
    const [password, setPassword] = useState('');
    const passwordRef = useRef<HTMLInputElement>(null);

    // ── xterm init — runs once, registers ONE onData handler ─────────────────
    useEffect(() => {
        if (!terminalRef.current) return;

        const term = new XTerm({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: '"Fira Code", "Cascadia Code", monospace',
            theme: {
                background: '#0f172a', foreground: '#f8fafc', cursor: '#38bdf8',
                selectionBackground: '#334155',
                black: '#1e293b', brightBlack: '#475569',
                red: '#f87171', brightRed: '#fca5a5',
                green: '#4ade80', brightGreen: '#86efac',
                yellow: '#facc15', brightYellow: '#fde68a',
                blue: '#60a5fa', brightBlue: '#93c5fd',
                magenta: '#c084fc', brightMagenta: '#d8b4fe',
                cyan: '#22d3ee', brightCyan: '#67e8f9',
                white: '#cbd5e1', brightWhite: '#f8fafc',
            },
        });

        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(terminalRef.current);
        fit.fit();
        xtermRef.current = term;
        fitRef.current = fit;

        // ── Single onData listener — forwards to active SSH session ──────────
        // Registered HERE (not inside connectWithPassword) so it is never
        // duplicated, even in React StrictMode double-invoke dev mode.
        onDataDisposableRef.current = term.onData((data) => {
            const sid = sessionIdRef.current;
            if (!sid) return;
            // Encode as base64 and forward — do NOT write locally,
            // the SSH server's PTY will echo back through the Tauri event.
            const encoded = btoa(
                Array.from(new TextEncoder().encode(data))
                    .map(b => String.fromCharCode(b))
                    .join('')
            );
            invoke('ssh_write', { sessionId: sid, data: encoded }).catch(() => { });
        });

        const onResize = () => fit.fit();
        window.addEventListener('resize', onResize);

        return () => {
            window.removeEventListener('resize', onResize);
            onDataDisposableRef.current?.dispose();
            term.dispose();
        };
    }, []); // empty deps — run once

    // ── Auto-connect when a saved password exists ─────────────────────────────
    useEffect(() => {
        if (server.has_saved_password) {
            connectWithPassword(null);
        }
        // No cleanup needed here — cleanup is in the unmount effect below
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Global cleanup on unmount ─────────────────────────────────────────────
    useEffect(() => {
        return () => {
            cleanupSession();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Focus password prompt ─────────────────────────────────────────────────
    useEffect(() => {
        if (connState === 'prompt') {
            setTimeout(() => passwordRef.current?.focus(), 50);
        }
    }, [connState]);

    // ── Helpers ───────────────────────────────────────────────────────────────

    const cleanupSession = async () => {
        unlistenDataRef.current?.();
        unlistenCloseRef.current?.();
        unlistenDataRef.current = null;
        unlistenCloseRef.current = null;

        if (sessionIdRef.current) {
            await invoke('ssh_disconnect', { sessionId: sessionIdRef.current }).catch(() => { });
            sessionIdRef.current = null;
        }
    };

    const connectWithPassword = async (pw: string | null) => {
        const term = xtermRef.current;
        setConnState('connecting');

        term?.writeln(
            `\x1b[1;34m[*] Conectando a ${server.username}@${server.host}:${server.port}...\x1b[0m`
        );
        if (server.has_saved_password && pw === null) {
            term?.writeln('\x1b[2m[🔒 Usando senha salva...]\x1b[0m');
        }

        try {
            const sessionId = await invoke<string>('ssh_connect', {
                serverId: server.id,
                password: pw,
            });
            sessionIdRef.current = sessionId;

            // Incoming data from server → write to xterm
            unlistenDataRef.current = await listen<string>(
                `ssh://data/${sessionId}`,
                (event) => {
                    const bytes = Uint8Array.from(atob(event.payload), c => c.charCodeAt(0));
                    xtermRef.current?.write(bytes);
                }
            );

            // Remote shell closed
            unlistenCloseRef.current = await listen(
                `ssh://close/${sessionId}`,
                () => {
                    xtermRef.current?.writeln('\r\n\x1b[33m[Conexão encerrada pelo servidor]\x1b[0m');
                    setConnState('error');
                }
            );

            setConnState('connected');
            term?.writeln(`\x1b[1;32m[✓] Conectado a ${server.name}\x1b[0m\r\n`);
            xtermRef.current?.focus();
        } catch (err) {
            term?.writeln(`\x1b[1;31m[✗] Erro: ${String(err)}\x1b[0m`);
            setConnState('error');
        }
    };

    const handleConnect = () => {
        if (password) connectWithPassword(password);
    };

    const handleClose = async () => {
        await cleanupSession();
        onClose();
    };

    const handleReconnect = () => {
        setPassword('');
        if (server.has_saved_password) {
            setConnState('loading');
            connectWithPassword(null);
        } else {
            setConnState('prompt');
        }
    };

    const statusLabel = {
        loading: <span className="text-yellow-400 ml-2">⟳ Iniciando...</span>,
        prompt: <span className="text-slate-400 ml-2">🔑 Aguardando senha</span>,
        connecting: <span className="text-yellow-400 ml-2">⟳ Conectando...</span>,
        connected: <span className="text-green-400 ml-2">● Conectado</span>,
        error: <span className="text-red-400 ml-2">✗ Desconectado</span>,
    }[connState];

    return (
        <div className="absolute inset-0 bg-[#0f172a] flex flex-col z-50">
            {/* Header bar */}
            <div className="h-10 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-4 shrink-0">
                <div className="flex items-center gap-3">
                    <span className="w-3 h-3 rounded-full bg-red-500" />
                    <span className="w-3 h-3 rounded-full bg-yellow-500" />
                    <span className={`w-3 h-3 rounded-full ${connState === 'connected' ? 'bg-green-500' : 'bg-slate-600'}`} />
                    <span className="text-xs font-mono text-slate-400 ml-1">
                        {server.username}@{server.host}:{server.port}
                        {statusLabel}
                    </span>
                </div>
                <button
                    onClick={handleClose}
                    className="text-slate-500 hover:text-white text-xs font-bold transition-colors px-2 py-1 rounded hover:bg-slate-800"
                >
                    ESC / FECHAR
                </button>
            </div>

            {/* Password prompt */}
            {connState === 'prompt' && (
                <div className="absolute inset-0 top-10 z-10 flex items-center justify-center bg-[#0f172a]/95 backdrop-blur-sm">
                    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 w-96 shadow-2xl">
                        <h3 className="text-lg font-semibold mb-1">Autenticação SSH</h3>
                        <p className="text-sm text-slate-400 font-mono mb-6">
                            {server.username}@{server.host}:{server.port}
                        </p>
                        <div className="mb-4">
                            <label className="block text-xs text-slate-500 mb-1">Senha</label>
                            <input
                                ref={passwordRef}
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleConnect(); }}
                                placeholder="••••••••"
                                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                        </div>
                        <p className="text-xs text-slate-600 mb-4">
                            💡 Edite o servidor e ative "Salvar senha" para se conectar sem digitar sempre.
                        </p>
                        <div className="flex gap-3">
                            <button onClick={handleClose} className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-sm font-semibold rounded-lg transition-colors">
                                Cancelar
                            </button>
                            <button onClick={handleConnect} disabled={!password} className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-sm font-semibold rounded-lg transition-colors">
                                Conectar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Error / reconnect */}
            {connState === 'error' && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex gap-3">
                    <button onClick={handleReconnect} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-sm font-semibold rounded-lg transition-colors shadow-xl">
                        Reconectar
                    </button>
                    <button onClick={handleClose} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-sm font-semibold rounded-lg transition-colors shadow-xl">
                        Fechar
                    </button>
                </div>
            )}

            {/* xterm container */}
            <div ref={terminalRef} className="flex-1 p-2 overflow-hidden" />
        </div>
    );
};

export default Terminal;
