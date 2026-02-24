import React, { useState, useEffect, useCallback, useRef } from 'react';
import Modal from '../Modal';
import {
    sftpDirectConnect, sftpListDir, sftpListLocal, sftpUpload, sftpDownload,
    sftpCloseSession, sftpWorkdir, sftpHomeDir, onSftpProgress,
    sftpDelete, sftpRename, sftpMkdir,
    sftpDeleteLocal, sftpRenameLocal, sftpMkdirLocal,
    type SftpEntry, type LocalEntry, type SftpProgress,
} from '../../lib/api/sftp';
import { getServerPassword } from '../../lib/api/servers';
import type { Server } from '../../hooks/useTerminalManager';
import { FolderPlus, Trash2, Pencil, RefreshCw } from 'lucide-react';

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
    onRename: (path: string) => void;
    onDelete: (path: string) => void;
    onMkdir: () => void;
    onRefresh: () => void;
}

const FilePane: React.FC<PaneProps> = ({
    title, icon, cwd, entries, loading, error, side,
    dropTarget, selected, onSelect, onNavigate,
    onDragStart, onDrop, onDragOver,
    onRename, onDelete, onMkdir, onRefresh,
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
            <div className="flex items-center justify-between px-3 py-2 bg-slate-900 border-b border-slate-800 shrink-0">
                <div className="flex items-center gap-2">
                    <span className="text-base">{icon}</span>
                    <span className="text-xs font-semibold text-slate-300">{title}</span>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={onMkdir}
                        title="Nova Pasta"
                        className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-sky-400 transition-colors"
                    >
                        <FolderPlus size={14} />
                    </button>
                    <button
                        onClick={() => selected && onRename(selected)}
                        disabled={!selected}
                        title="Renomear"
                        className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-sky-400 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    >
                        <Pencil size={14} />
                    </button>
                    <button
                        onClick={() => selected && onDelete(selected)}
                        disabled={!selected}
                        title="Deletar"
                        className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-red-400 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                    >
                        <Trash2 size={14} />
                    </button>
                    <div className="w-px h-3 bg-slate-800 mx-1" />
                    <button
                        onClick={onRefresh}
                        title="Sincronizar"
                        className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-sky-400 transition-colors"
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
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
    const [localCwd, setLocalCwd] = useState('/');
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
    const [progress, setProgress] = useState<SftpProgress | null>(null);

    // Modal state
    interface ModalState {
        isOpen: boolean;
        type: 'rename' | 'delete' | 'mkdir';
        side: 'local' | 'remote';
        targetPath?: string;
        inputValue: string;
        description: string;
    }

    const [modal, setModal] = useState<ModalState>({
        isOpen: false,
        type: 'mkdir',
        side: 'local',
        inputValue: '',
        description: '',
    });

    // Track connection attempt to avoid loops
    const connectAttempted = useRef(false);

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

    // ── Pre-fetch local home ──
    useEffect(() => {
        sftpHomeDir().then(dir => {
            setLocalCwd(dir);
            listLocal(dir);
        }).catch(() => listLocal('/'));
    }, [listLocal]);

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

    // ── Connect ───────────────────────────────────────────────────────────────
    const doConnect = useCallback(async (pw: string) => {
        if (sftp) return;
        setConnState('connecting');
        try {
            const id = await sftpDirectConnect(server.host, server.port, server.username, pw);
            setSftp(id);
            setConnState('connected');

            // Get remote home
            try {
                const wDir = await sftpWorkdir(id);
                setRemoteCwd(wDir);
                // Call listRemote directly with the new ID to avoid dependency on sftp state
                setRemoteLoading(true);
                setRemoteError(null);
                try {
                    const entries = await sftpListDir(id, wDir);
                    setRemoteEntries(entries);
                    setRemoteCwd(wDir);
                } catch (e) {
                    setRemoteError(String(e));
                } finally {
                    setRemoteLoading(false);
                }
            } catch {
                listRemote('/'); // fallback
            }
        } catch (e) {
            setConnState('error');
            setLocalError(String(e));
            connectAttempted.current = false;
        }
    }, [server, sftp, listRemote]);

    useEffect(() => {
        if (connectAttempted.current) return;

        if (server.has_saved_password) {
            connectAttempted.current = true;
            getServerPassword(server.id).then(pw => {
                if (pw) doConnect(pw);
                else {
                    setConnState('prompt');
                    connectAttempted.current = false;
                }
            }).catch(() => {
                setConnState('prompt');
                connectAttempted.current = false;
            });
        } else {
            setConnState('prompt');
        }
    }, [server.id, server.has_saved_password, doConnect]);

    // Explicit listRemote that takes a path but uses current sftp
    const listRemotePath = useCallback(async (path: string) => {
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

    useEffect(() => {
        if (!sftp) return;
        const unlisten = onSftpProgress(sftp, (p) => {
            setProgress(p);
            if (p.bytes_done === p.bytes_total) {
                setTimeout(() => setProgress(null), 2000);
            }
        });
        return () => {
            unlisten.then(f => f());
            sftpCloseSession(sftp);
        };
    }, [sftp]);

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
            const remotePath = `${targetDir.replace(/\/$/, '')}/${dragging.name}`;
            try {
                await sftpUpload(sftp, dragging.path, remotePath);
                await listRemote(remoteCwd);
            } catch (e) {
                setRemoteError(`Erro no upload: ${String(e)}`);
            }
        } else {
            const localPath = `${targetDir.replace(/\/$/, '')}/${dragging.name}`;
            try {
                await sftpDownload(sftp, dragging.path, localPath);
                await listLocal(localCwd);
            } catch (e) {
                setLocalError(`Erro no download: ${String(e)}`);
            }
        }
        setDragging(null);
    }, [dragging, sftp, remoteCwd, localCwd, listRemote, listLocal]);

    const handleConfirmModal = async (value: string) => {
        const { type, side, targetPath } = modal;
        setModal(prev => ({ ...prev, isOpen: false }));

        try {
            if (side === 'local') {
                if (type === 'rename' && targetPath) {
                    const parent = targetPath.split('/').slice(0, -1).join('/') || '/';
                    const newPath = `${parent.replace(/\/$/, '')}/${value}`;
                    await sftpRenameLocal(targetPath, newPath);
                } else if (type === 'delete' && targetPath) {
                    await sftpDeleteLocal(targetPath);
                    setLocalSelected(null);
                } else if (type === 'mkdir') {
                    const path = `${localCwd.replace(/\/$/, '')}/${value}`;
                    await sftpMkdirLocal(path);
                }
                await listLocal(localCwd);
            } else {
                if (!sftp) return;
                if (type === 'rename' && targetPath) {
                    const parent = targetPath.split('/').slice(0, -1).join('/') || '/';
                    const newPath = `${parent.replace(/\/$/, '')}/${value}`;
                    await sftpRename(sftp, targetPath, newPath);
                } else if (type === 'delete' && targetPath) {
                    await sftpDelete(sftp, targetPath);
                    setRemoteSelected(null);
                } else if (type === 'mkdir') {
                    const path = `${remoteCwd.replace(/\/$/, '')}/${value}`;
                    await sftpMkdir(sftp, path);
                }
                await listRemotePath(remoteCwd);
            }
        } catch (e) {
            const err = String(e);
            if (side === 'local') setLocalError(err);
            else setRemoteError(err);
        }
    };

    // ── Local Actions ──────────────────────────────────────────────────────────
    const handleLocalRename = useCallback((path: string) => {
        const name = path.split('/').pop() || '';
        setModal({
            isOpen: true,
            type: 'rename',
            side: 'local',
            targetPath: path,
            inputValue: name,
            description: `Renomear "${name}" para:`,
        });
    }, []);

    const handleLocalDelete = useCallback((path: string) => {
        const name = path.split('/').pop() || '';
        setModal({
            isOpen: true,
            type: 'delete',
            side: 'local',
            targetPath: path,
            inputValue: '',
            description: `Tem certeza que deseja deletar "${name}"?`,
        });
    }, []);

    const handleLocalMkdir = useCallback(() => {
        setModal({
            isOpen: true,
            type: 'mkdir',
            side: 'local',
            targetPath: '',
            inputValue: '',
            description: 'Nome da nova pasta:',
        });
    }, []);

    // ── Remote Actions ─────────────────────────────────────────────────────────
    const handleRemoteRename = useCallback((path: string) => {
        const name = path.split('/').pop() || '';
        setModal({
            isOpen: true,
            type: 'rename',
            side: 'remote',
            targetPath: path,
            inputValue: name,
            description: `Renomear "${name}" para:`,
        });
    }, []);

    const handleRemoteDelete = useCallback((path: string) => {
        const name = path.split('/').pop() || '';
        setModal({
            isOpen: true,
            type: 'delete',
            side: 'remote',
            targetPath: path,
            inputValue: '',
            description: `Tem certeza que deseja deletar "${name}"?`,
        });
    }, []);

    const handleRemoteMkdir = useCallback(() => {
        setModal({
            isOpen: true,
            type: 'mkdir',
            side: 'remote',
            targetPath: '',
            inputValue: '',
            description: 'Nome da nova pasta:',
        });
    }, []);


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
                        onRename={handleLocalRename}
                        onDelete={handleLocalDelete}
                        onMkdir={handleLocalMkdir}
                        onRefresh={() => listLocal(localCwd)}
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
                            try { await sftpUpload(sftp, localSelected, remotePath); await listRemote(remoteCwd); }
                            catch (e) { setRemoteError(`Upload falhou: ${String(e)}`); }
                        }}
                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-sky-700 disabled:opacity-30 transition-colors text-sm"
                    >→</button>
                    <button
                        title="Download ← (remoto para local)"
                        disabled={!remoteSelected || remoteEntries.find(e => e.path === remoteSelected)?.is_dir || progress !== null}
                        onClick={async () => {
                            if (!remoteSelected || !sftp) return;
                            const name = remoteSelected.split('/').pop()!;
                            const localPath = `${localCwd.replace(/\/$/, '')}/${name}`;
                            try { await sftpDownload(sftp, remoteSelected, localPath); await listLocal(localCwd); }
                            catch (e) { setLocalError(`Download falhou: ${String(e)}`); }
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
                        onNavigate={listRemotePath}
                        onDragStart={handleDragStart}
                        onDrop={handleDrop}
                        onDragOver={handleDragOver}
                        onRename={handleRemoteRename}
                        onDelete={handleRemoteDelete}
                        onMkdir={handleRemoteMkdir}
                        onRefresh={() => listRemotePath(remoteCwd)}
                    />
                </div>
            </div>

            {/* Bottom Progress Bar */}
            {progress && (
                <div className="h-8 bg-slate-900 border-t border-slate-800 flex items-center px-4 shrink-0 shadow-[0_-4px_10px_rgba(0,0,0,0.2)] z-10">
                    <div className="flex items-center w-full max-w-2xl mx-auto gap-4">
                        <span className="text-xs text-slate-400 truncate w-64">{progress.file}</span>
                        <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden border border-slate-700/50">
                            <div
                                className="h-full bg-gradient-to-r from-sky-500 to-cyan-400 transition-all duration-300 ease-out shadow-[0_0_8px_rgba(56,189,248,0.5)]"
                                style={{ width: `${(progress.bytes_done / Math.max(1, progress.bytes_total)) * 100}%` }}
                            />
                        </div>
                        <span className="text-xs font-mono text-slate-300 w-12 text-right">
                            {Math.round((progress.bytes_done / Math.max(1, progress.bytes_total)) * 100)}%
                        </span>
                    </div>
                </div>
            )}

            <Modal
                isOpen={modal.isOpen}
                onClose={() => setModal(prev => ({ ...prev, isOpen: false }))}
                title={modal.type === 'rename' ? 'Renomear' : modal.type === 'delete' ? 'Deletar' : 'Nova Pasta'}
                icon={
                    modal.type === 'rename' ? <Pencil size={18} className="text-sky-400" /> :
                        modal.type === 'delete' ? <Trash2 size={18} className="text-red-400" /> :
                            <FolderPlus size={18} className="text-sky-400" />
                }
                width="w-[400px]"
            >
                <div className="flex flex-col">
                    {modal.description && (
                        <p className="text-sm text-slate-400 mb-5">{modal.description}</p>
                    )}

                    {(modal.type === 'rename' || modal.type === 'mkdir') && (
                        <input
                            autoFocus
                            value={modal.inputValue}
                            onChange={(e) => setModal(prev => ({ ...prev, inputValue: e.target.value }))}
                            onKeyDown={(e) => e.key === 'Enter' && handleConfirmModal(modal.inputValue)}
                            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-sky-500/40 mb-6 transition-all"
                            placeholder={modal.type === 'mkdir' ? 'Nome da pasta' : 'Novo nome'}
                        />
                    )}

                    <div className="flex items-center justify-end gap-3">
                        <button
                            onClick={() => setModal(prev => ({ ...prev, isOpen: false }))}
                            className="px-4 py-2 rounded-xl text-sm font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={() => handleConfirmModal(modal.inputValue)}
                            className={`px-6 py-2 rounded-xl text-sm font-medium text-white transition-all shadow-lg active:scale-95 ${modal.type === 'delete' ? 'bg-red-600 hover:bg-red-500 shadow-red-900/20' : 'bg-sky-600 hover:bg-sky-500 shadow-sky-900/20'
                                }`}
                        >
                            {modal.type === 'delete' ? 'Deletar' : modal.type === 'rename' ? 'Salvar' : 'Criar'}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default SftpDualPane;
