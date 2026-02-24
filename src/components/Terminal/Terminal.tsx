import React, { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

interface Props {
    serverId: string;
    onClose: () => void;
}

const Terminal: React.FC<Props> = ({ serverId, onClose }) => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<XTerm | null>(null);

    useEffect(() => {
        if (!terminalRef.current) return;

        const term = new XTerm({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: 'Fira Code, monospace',
            theme: {
                background: '#0f172a',
                foreground: '#f8fafc',
            }
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(terminalRef.current);
        fitAddon.fit();

        term.writeln('\x1b[1;34m[*] Conectando ao servidor...\x1b[0m');
        term.writeln('\x1b[1;32m[OK] Conexão estabelecida.\x1b[0m');
        term.writeln('');
        term.write('$ ');

        term.onData(data => {
            // Mock echo for now
            if (data === '\r') {
                term.write('\r\n$ ');
            } else {
                term.write(data);
            }
        });

        xtermRef.current = term;

        return () => {
            term.dispose();
        };
    }, [serverId]);

    return (
        <div className="absolute inset-0 bg-background flex flex-col z-50">
            <div className="h-10 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-4">
                <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-red-500" />
                    <span className="text-xs font-mono text-slate-400">terminal session - {serverId}</span>
                </div>
                <button
                    onClick={onClose}
                    className="text-slate-500 hover:text-white text-xs font-bold"
                >
                    ESC/FECHAR
                </button>
            </div>
            <div ref={terminalRef} className="flex-1 p-2" />
        </div>
    );
};

export default Terminal;
