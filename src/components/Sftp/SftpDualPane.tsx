import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    sftpDirectConnect, sftpListDir, sftpListLocal, sftpUpload, sftpDownload,
    sftpCloseSession, type SftpEntry, type LocalEntry,
} from '../../lib/api/sftp';
import { getServerPassword } from '../../lib/api/servers';
import type { Server } from '../../hooks/useTerminalManager';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DragItem {
    side: 'local' | 'remote';
    path: string;
    name: string;
    is_dir: boolean;
}

interface Props {
    server: Server;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (bytes: number) => {
    if (bytes === 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const HOME = '/';

// ─── Sub-components ───────────────────────────────────────────────────────────

interface PaneProps {
    title: string;
    icon: string;
    cwd: string;
    entries: Array<{ name: string; path: string; is_dir: boolean; size: number }>;
    loading: boolean;
    error: string | null;
    side: 'local' | 'remote';
    dropTarget: boolean;
    selected: string | null;
    onSelect: (path: string) => void;
    onNavigate: (path: string) => void;
    onDragStart: (item: DragItem) => void;
    onDrop: (target: 'local' | 'remote', targetDir: string) => void;
    onDragOver: (e: React.DragEvent, side: 'local' | 'remote') => void;
}

const FilePane: React.FC<PaneProps> = ({
    title, icon, cwd, entries, loading, error, side,
    dropTarget, selected, onSelect, onNavigate,
    onDragStart, onDrop, onDragOver,
}) => {
    const parent = cwd.split('/').slice(0, -1).join('/') || '/';
    const segments = cwd.split('/').filter(Boolean);

    return (
        <div
            className={`flex flex-col h-full min-w-0 transition-colors ${dropTarget ? 'bg-sky-950/30' : 'bg-slate-950'}`}
            onDragOver={(e) => { e.preventDefault(); onDragOver(e, side); }}
            onDrop={() => onDrop(side, cwd)}
        >
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-900 border-b border-slate-800 shrink-0">
                <span className="text-base">{icon}</span>
                <span className="text-xs font-semibold text-slate-300">{title}</span>
            </div>

            {/* Breadcrumb */}
            <div className="flex items-center gap-1 px-2 py-1 border-b border-slate-800 overflow-x-auto scrollbar-none shrink-0">
                <button
                    onClick={() => onNavigate('/')}
                    className="text-xs text-sky-400 hover:text-sky-200 font-mono shrink-0"
                >/</button>
                {segments.map((seg, i) => {
                    const path = '/' + segments.slice(0, i + 1).join('/');
                    return (
                        <React.Fragment key={path}>
                            <span className="text-slate-700 shrink-0 text-xs">/</span>
                            <button
                                onClick={() => onNavigate(path)}
                                className="text-xs text-sky-400 hover:text-sky-200 font-mono shrink-0 max-w-[80px] truncate"
                            >{seg}</button>
                        </React.Fragment>
                    );
                })}
            </div>

            {/* File list */}
            <div className="flex-1 overflow-y-auto text-xs">
                {loading && (
                    <div className="flex items-center justify-center h-20 text-slate-500 animate-pulse text-xs">Carregando...</div>
                )}
                {error && (
                    <div className="p-3 text-red-400 text-xs">⚠ {error}</div>
                )}

                {/* ".." parent entry */}
                {!loading && cwd !== '/' && (
                    <div
                        className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-900 cursor-pointer text-slate-400"
                        onDoubleClick={() => onNavigate(parent)}
                    >
                        <span>📂</span>
                        <span className="font-mono">..</span>
                    </div>
                )}

                {!loading && entries.map(entry => {
                    const isSelected = selected === entry.path;
                    return (
                        <div
                            key={entry.path}
                            className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none transition-colors group ${isSelected ? 'bg-sky-900/40 text-white' : 'hover:bg-slate-900 text-slate-300'
                                }`}
                            onClick={() => onSelect(entry.path)}
                            onDoubleClick={() => entry.is_dir && onNavigate(entry.path)}
                            draggable
                            onDragStart={() => onDragStart({ side, path: entry.path, name: entry.name, is_dir: entry.is_dir })}
                        >
                            <span className="shrink-0">{entry.is_dir ? '📂' : '📄'}</span>
                            <span className="flex-1 font-mono truncate">{entry.name}</span>
                            {!entry.is_dir && (
                                <span className="text-slate-600 shrink-0">{fmt(entry.size)}</span>
                            )}
                        </div>
                    );
                })}

                {!loading && !error && entries.length === 0 && (
                    <div className="flex items-center justify-center h-20 text-slate-600 text-xs">Pasta vazia</div>
                )}
            </div>

            {/* Drop hint */}
            {dropTarget && (
                <div className="px-3 py-2 text-xs text-sky-400 text-center bg-sky-950/40 border-t border-sky-800 animate-pulse shrink-0">
                    ↓ Solte aqui para {side === 'local' ? 'fazer download' : 'fazer upload'}
                </div>
            )}
        </div>
    );
};

// ─── Main component ───────────────────────────────────────────────────────────

const SftpDualPane: React.FC<Props> = ({ server }) => {
    // Connection state
    const [sftp, setSftp] = useState<string | null>(null);
    const [connState, setConnState] = useState<'connecting' | 'prompt' | 'connected' | 'error'>('connecting');
    const [password, setPassword] = useState('');
    const pwInputRef = useRef<HTMLInputElement>(null);

    // Local pane
    const [localCwd, setLocalCwd] = useState(HOME);
    const [localEntries, setLocalEntries] = useState<LocalEntry[]>([]);
    const [localLoading, setLocalLoading] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);
    const [localSelected, setLocalSelected] = useState<string | null>(null);

    // Remote pane
    const [remoteCwd, setRemoteCwd] = useState('/');
    const [remoteEntries, setRemoteEntries] = useState<SftpEntry[]>([]);
    const [remoteLoading, setRemoteLoading] = useState(false);
    const [remoteError, setRemoteError] = useState<string | null>(null);
    const [remoteSelected, setRemoteSelected] = useState<string | null>(null);

    // Drag & drop
    const [dragging, setDragging] = useState<DragItem | null>(null);
    const [dropSide, setDropSide] = useState<'local' | 'remote' | null>(null);

    // Transfer status
    const [transferMsg, setTransferMsg] = useState<string | null>(null);

    // ── Connect ───────────────────────────────────────────────────────────────
    const doConnect = useCallback(async (pw: string) => {
        setConnState('connecting');
        try {
            const id = await sftpDirectConnect(server.host, server.port, server.username, pw);
            setSftp(id);
            setConnState('connected');
        } catch (e) {
            setConnState('error');
            setLocalError(String(e));
        }
    }, [server]);

    useEffect(() => {
        if (server.has_saved_password) {
            getServerPassword(server.id).then(pw => {
                if (pw) doConnect(pw);
                else setConnState('prompt');
            }).catch(() => setConnState('prompt'));
        } else {
            setConnState('prompt');
        }
        return () => { if (sftp) sftpCloseSession(sftp); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── List local ───────────────────────────────────────────────────────────
    const listLocal = useCallback(async (path: string) => {
        setLocalLoading(true);
        setLocalError(null);
        try {
            const entries = await sftpListLocal(path);
            setLocalEntries(entries);
            setLocalCwd(path);
        } catch (e) {
            setLocalError(String(e));
        } finally {
            setLocalLoading(false);
        }
    }, []);

    // ── List remote ──────────────────────────────────────────────────────────
    const listRemote = useCallback(async (path: string) => {
        if (!sftp) return;
        setRemoteLoading(true);
        setRemoteError(null);
        try {
            const entries = await sftpListDir(sftp, path);
            setRemoteEntries(entries);
            setRemoteCwd(path);
        } catch (e) {
            setRemoteError(String(e));
        } finally {
            setRemoteLoading(false);
        }
    }, [sftp]);

    useEffect(() => { listLocal(localCwd); }, []); // eslint-disable-line
    useEffect(() => {
        if (sftp) { listRemote(remoteCwd); }
    }, [sftp]); // eslint-disable-line

    // ── Drag & Drop ──────────────────────────────────────────────────────────
    const handleDragStart = useCallback((item: DragItem) => {
        setDragging(item);
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent, side: 'local' | 'remote') => {
        e.preventDefault();
        if (dragging && dragging.side !== side) setDropSide(side);
    }, [dragging]);

    const handleDrop = useCallback(async (targetSide: 'local' | 'remote', targetDir: string) => {
        setDropSide(null);
        if (!dragging || dragging.side === targetSide || dragging.is_dir || !sftp) return;

        if (targetSide === 'remote') {
            // local → remote: upload
            const remotePath = `${targetDir.replace(/\/$/, '')}/${dragging.name}`;
            setTransferMsg(`⬆ Fazendo upload: ${dragging.name}...`);
            try {
                await sftpUpload(sftp, dragging.path, remotePath);
                setTransferMsg(`✓ Upload concluído: ${dragging.name}`);
                await listRemote(remoteCwd);
            } catch (e) {
                setTransferMsg(`✗ Erro no upload: ${String(e)}`);
            }
        } else {
            // remote → local: download
            const localPath = `${targetDir.replace(/\/$/, '')}/${dragging.name}`;
            setTransferMsg(`⬇ Fazendo download: ${dragging.name}...`);
            try {
                await sftpDownload(sftp, dragging.path, localPath);
                setTransferMsg(`✓ Download concluído: ${dragging.name}`);
                await listLocal(localCwd);
            } catch (e) {
                setTransferMsg(`✗ Erro no download: ${String(e)}`);
            }
        }
        setDragging(null);
        setTimeout(() => setTransferMsg(null), 3000);
    }, [dragging, sftp, remoteCwd, localCwd, listRemote, listLocal]);

    // ── Render ────────────────────────────────────────────────────────────────

    if (connState === 'prompt' || connState === 'error') {
        return (
            <div className="flex-1 flex items-center justify-center bg-[#0f172a]">
                <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 w-96 shadow-2xl">
                    <h3 className="text-lg font-semibold mb-1">Autenticação SFTP</h3>
                    <p className="text-sm text-slate-400 font-mono mb-5">{server.username}@{server.host}:{server.port}</p>
                    {connState === 'error' && <p className="text-xs text-red-400 mb-3">{localError}</p>}
                    <label className="block text-xs text-slate-500 mb-1">Senha</label>
                    <input
                        ref={pwInputRef}
                        type="password"
                        autoFocus
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && doConnect(password)}
                        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-sky-500 mb-4"
                        placeholder="senha SSH"
                    />
                    <button
                        onClick={() => doConnect(password)}
                        disabled={!password}
                        className="w-full py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 rounded-xl text-sm font-medium transition-colors"
                    >Conectar</button>
                </div>
            </div>
        );
    }

    if (connState === 'connecting') {
        return (
            <div className="flex-1 flex items-center justify-center bg-[#0f172a] text-slate-500 animate-pulse">
                Conectando SFTP...
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full w-full overflow-hidden bg-slate-950">
            {/* Transfer status bar */}
            {transferMsg && (
                <div className="px-4 py-1.5 text-xs bg-sky-950 text-sky-300 border-b border-sky-800 shrink-0">
                    {transferMsg}
                </div>
            )}

            {/* Dual pane — 50/50 split */}
            <div className="flex flex-1 overflow-hidden divide-x divide-slate-800">
                {/* Local pane */}
                <div className="flex-1 min-w-0">
                    <FilePane
                        title="Local"
                        icon="🖥"
                        side="local"
                        cwd={localCwd}
                        entries={localEntries}
                        loading={localLoading}
                        error={localError}
                        dropTarget={dropSide === 'local'}
                        selected={localSelected}
                        onSelect={setLocalSelected}
                        onNavigate={listLocal}
                        onDragStart={handleDragStart}
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                    />
                </div>

                {/* Transfer buttons (center strip) */}
                <div className="flex flex-col items-center justify-center gap-2 px-1 bg-slate-900 shrink-0">
                    <button
                        title="Upload → (local para remoto)"
                        disabled={!localSelected || localEntries.find(e => e.path === localSelected)?.is_dir}
                        onClick={async () => {
                            if (!localSelected || !sftp) return;
                            const name = localSelected.split('/').pop()!;
                            const remotePath = `${remoteCwd.replace(/\/$/, '')}/${name}`;
                            setTransferMsg(`⬆ ${name}...`);
                            try { await sftpUpload(sftp, localSelected, remotePath); await listRemote(remoteCwd); setTransferMsg(`✓ ${name}`); }
                            catch (e) { setTransferMsg(`✗ ${String(e)}`); }
                            setTimeout(() => setTransferMsg(null), 3000);
                        }}
                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-sky-700 disabled:opacity-30 transition-colors text-sm"
                    >→</button>
                    <button
                        title="Download ← (remoto para local)"
                        disabled={!remoteSelected || remoteEntries.find(e => e.path === remoteSelected)?.is_dir}
                        onClick={async () => {
                            if (!remoteSelected || !sftp) return;
                            const name = remoteSelected.split('/').pop()!;
                            const localPath = `${localCwd.replace(/\/$/, '')}/${name}`;
                            setTransferMsg(`⬇ ${name}...`);
                            try { await sftpDownload(sftp, remoteSelected, localPath); await listLocal(localCwd); setTransferMsg(`✓ ${name}`); }
                            catch (e) { setTransferMsg(`✗ ${String(e)}`); }
                            setTimeout(() => setTransferMsg(null), 3000);
                        }}
                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-sky-700 disabled:opacity-30 transition-colors text-sm"
                    >←</button>
                </div>

                {/* Remote pane */}
                <div className="flex-1 min-w-0">
                    <FilePane
                        title={`Remoto — ${server.host}`}
                        icon="🌐"
                        side="remote"
                        cwd={remoteCwd}
                        entries={remoteEntries}
                        loading={remoteLoading}
                        error={remoteError}
                        dropTarget={dropSide === 'remote'}
                        selected={remoteSelected}
                        onSelect={setRemoteSelected}
                        onNavigate={listRemote}
                        onDragStart={handleDragStart}
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                    />
                </div>
            </div>
        </div>
    );
};

export default SftpDualPane;
