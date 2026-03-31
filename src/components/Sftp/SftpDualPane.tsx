import React, { useState, useEffect, useCallback, useRef } from 'react';
import Modal from '../Modal';
import {
    sftpDirectConnect, sftpListDir, sftpListLocal, sftpUpload, sftpDownload,
    sftpCloseSession, sftpWorkdir, sftpHomeDir, onSftpProgress,
    sftpDelete, sftpRename, sftpMkdir,
    sftpDeleteLocal, sftpRenameLocal, sftpMkdirLocal,
    type SftpEntry, type LocalEntry, type SftpProgress,
} from '../../lib/api/sftp';
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
            className={`flex flex-col h-full min-w-0 transition-colors`}
            style={{
                background: dropTarget ? "rgba(10,132,255,0.06)" : "#000000",
            }}
            onDragOver={(e) => { e.preventDefault(); onDragOver(e, side); }}
            onDrop={() => onDrop(side, cwd)}
        >
            {/* Header */}
            <div
                className="flex items-center justify-between px-3 py-2 shrink-0"
                style={{
                    background: "rgba(28,28,30,0.72)",
                    backdropFilter: "blur(20px) saturate(180%)",
                    WebkitBackdropFilter: "blur(20px) saturate(180%)",
                    borderBottom: "0.5px solid rgba(255,255,255,0.08)",
                }}
            >
                <div className="flex items-center gap-2">
                    <span className="text-base">{icon}</span>
                    <span className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.75)" }}>{title}</span>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={onMkdir}
                        title="Nova Pasta"
                        className="p-1 rounded-lg transition-colors"
                        style={{ color: "rgba(255,255,255,0.4)" }}
                        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#0a84ff"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.4)"; }}
                    >
                        <FolderPlus size={14} />
                    </button>
                    <button
                        onClick={() => selected && onRename(selected)}
                        disabled={!selected}
                        title="Renomear"
                        className="p-1 rounded-lg transition-colors disabled:opacity-30"
                        style={{ color: "rgba(255,255,255,0.4)" }}
                        onMouseEnter={e => { if (!e.currentTarget.disabled) { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#0a84ff"; } }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.4)"; }}
                    >
                        <Pencil size={14} />
                    </button>
                    <button
                        onClick={() => selected && onDelete(selected)}
                        disabled={!selected}
                        title="Deletar"
                        className="p-1 rounded-lg transition-colors disabled:opacity-30"
                        style={{ color: "rgba(255,255,255,0.4)" }}
                        onMouseEnter={e => { if (!e.currentTarget.disabled) { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#ff453a"; } }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.4)"; }}
                    >
                        <Trash2 size={14} />
                    </button>
                    <div className="w-px h-3 mx-1" style={{ background: "rgba(255,255,255,0.1)" }} />
                    <button
                        onClick={onRefresh}
                        title="Sincronizar"
                        className="p-1 rounded-lg transition-colors"
                        style={{ color: "rgba(255,255,255,0.4)" }}
                        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#0a84ff"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.4)"; }}
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* Breadcrumb */}
            <div
                className="flex items-center gap-1 px-2 py-1 overflow-x-auto scrollbar-none shrink-0"
                style={{ borderBottom: "0.5px solid rgba(255,255,255,0.06)" }}
            >
                <button
                    onClick={() => onNavigate('/')}
                    className="text-xs font-mono shrink-0 transition-colors"
                    style={{ color: "#0a84ff" }}
                >/</button>
                {segments.map((seg, i) => {
                    const path = '/' + segments.slice(0, i + 1).join('/');
                    return (
                        <React.Fragment key={path}>
                            <span className="text-xs shrink-0" style={{ color: "rgba(255,255,255,0.2)" }}>/</span>
                            <button
                                onClick={() => onNavigate(path)}
                                className="text-xs font-mono shrink-0 max-w-[80px] truncate transition-colors"
                                style={{ color: "#0a84ff" }}
                            >{seg}</button>
                        </React.Fragment>
                    );
                })}
            </div>

            {/* File list */}
            <div className="flex-1 overflow-y-auto text-xs">
                {loading && (
                    <div className="flex items-center justify-center h-20 text-xs animate-pulse" style={{ color: "rgba(255,255,255,0.3)" }}>Carregando...</div>
                )}
                {error && (
                    <div className="p-3 text-xs" style={{ color: "#ff453a" }}>⚠ {error}</div>
                )}

                {/* ".." parent entry */}
                {!loading && cwd !== '/' && (
                    <div
                        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors"
                        style={{ color: "rgba(255,255,255,0.4)" }}
                        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
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
                            className="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none transition-colors"
                            style={{
                                background: isSelected ? "rgba(10,132,255,0.2)" : "transparent",
                                color: isSelected ? "#ffffff" : "rgba(255,255,255,0.75)",
                            }}
                            onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                            onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                            onClick={() => onSelect(entry.path)}
                            onDoubleClick={() => entry.is_dir && onNavigate(entry.path)}
                            draggable
                            onDragStart={() => onDragStart({ side, path: entry.path, name: entry.name, is_dir: entry.is_dir })}
                        >
                            <span className="shrink-0">{entry.is_dir ? '📂' : '📄'}</span>
                            <span className="flex-1 font-mono truncate">{entry.name}</span>
                            {!entry.is_dir && (
                                <span className="shrink-0" style={{ color: "rgba(255,255,255,0.25)" }}>{fmt(entry.size)}</span>
                            )}
                        </div>
                    );
                })}

                {!loading && !error && entries.length === 0 && (
                    <div className="flex items-center justify-center h-20 text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>Pasta vazia</div>
                )}
            </div>

            {/* Drop hint */}
            {dropTarget && (
                <div
                    className="px-3 py-2 text-xs text-center animate-pulse shrink-0"
                    style={{
                        color: "#0a84ff",
                        background: "rgba(10,132,255,0.08)",
                        borderTop: "0.5px solid rgba(10,132,255,0.3)",
                    }}
                >
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
    const [connError, setConnError] = useState<string | null>(null);
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

    // Used to cancel a doConnect in-flight when the component unmounts
    const cancelConnectRef = useRef(false);

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
    // `pw` is only provided when the user types a password manually at the prompt.
    // When null, the backend resolves credentials from the vault (saved password or SSH key).
    const doConnect = useCallback(async (pw: string | null) => {
        if (sftp) return;
        setConnState('connecting');
        setConnError(null);
        try {
            const id = await sftpDirectConnect(server.id, pw);
            if (cancelConnectRef.current) {
                // Component unmounted during connect — close the session silently
                sftpCloseSession(id);
                return;
            }
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
            if (cancelConnectRef.current) return; // ignore errors after unmount
            setConnState('error');
            setConnError(String(e));
        }
    }, [server, sftp, listRemote]);

    useEffect(() => {
        if (server.has_saved_password || server.has_saved_ssh_key) {
            doConnect(null).catch(() => setConnState('prompt'));
        } else {
            setConnState('prompt');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [server.id]);

    // ── Unmount cleanup — signal cancelConnectRef so in-flight connect aborts ──
    useEffect(() => {
        // Reset on mount (important for React Strict Mode double-invoke)
        cancelConnectRef.current = false;
        return () => { cancelConnectRef.current = true; };
    }, []);

    // ── Subscribe to transfer progress + cleanup session on unmount ───────────
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
                await listRemote(remoteCwd);
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
            <div className="flex-1 flex items-center justify-center" style={{ background: "#000000" }}>
                <div
                    className="rounded-3xl p-8 w-96 shadow-2xl"
                    style={{
                        background: "rgba(28,28,30,0.88)",
                        backdropFilter: "blur(40px) saturate(180%)",
                        WebkitBackdropFilter: "blur(40px) saturate(180%)",
                        border: "0.5px solid rgba(255,255,255,0.12)",
                    }}
                >
                    <h3 className="text-base font-semibold mb-1">Autenticação SFTP</h3>
                    <p className="text-xs font-mono mb-5" style={{ color: "rgba(255,255,255,0.4)" }}>
                        {server.username}@{server.host}:{server.port}
                    </p>
                    {connState === 'error' && (
                        <p className="text-xs mb-3" style={{ color: "#ff453a" }}>{connError}</p>
                    )}
                    <label className="block text-[11px] font-medium mb-1.5" style={{ color: "rgba(255,255,255,0.45)" }}>Senha</label>
                    <input
                        ref={pwInputRef}
                        type="password"
                        autoFocus
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && doConnect(password)}
                        className="w-full rounded-xl px-3 py-2.5 text-sm mb-5 transition-all focus:outline-none"
                        style={{
                            background: "rgba(255,255,255,0.07)",
                            border: "0.5px solid rgba(255,255,255,0.1)",
                            color: "rgba(255,255,255,0.9)",
                        }}
                        onFocus={e => {
                            e.currentTarget.style.border = "0.5px solid #0a84ff";
                            e.currentTarget.style.boxShadow = "0 0 0 3px rgba(10,132,255,0.15)";
                        }}
                        onBlur={e => {
                            e.currentTarget.style.border = "0.5px solid rgba(255,255,255,0.1)";
                            e.currentTarget.style.boxShadow = "none";
                        }}
                        placeholder="senha SSH"
                    />
                    <button
                        onClick={() => doConnect(password)}
                        disabled={!password}
                        className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-[0.98] disabled:opacity-40"
                        style={{ background: "#0a84ff", color: "#ffffff" }}
                    >Conectar</button>
                </div>
            </div>
        );
    }

    if (connState === 'connecting') {
        return (
            <div className="flex-1 flex items-center justify-center text-xs animate-pulse" style={{ background: "#000000", color: "rgba(255,255,255,0.35)" }}>
                Conectando SFTP...
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full w-full overflow-hidden" style={{ background: "#000000" }}>
            {/* Dual pane — 50/50 split */}
            <div className="flex flex-1 overflow-hidden" style={{ borderRight: "0.5px solid rgba(255,255,255,0.06)" }}>
                {/* Local pane */}
                <div className="flex-1 min-w-0" style={{ borderRight: "0.5px solid rgba(255,255,255,0.06)" }}>
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
                <div
                    className="flex flex-col items-center justify-center gap-2 px-1 shrink-0"
                    style={{ background: "rgba(28,28,30,0.6)" }}
                >
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
                        className="w-7 h-7 flex items-center justify-center rounded-lg transition-all disabled:opacity-30 text-sm"
                        style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)" }}
                        onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.background = "#0a84ff"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
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
                        className="w-7 h-7 flex items-center justify-center rounded-lg transition-all disabled:opacity-30 text-sm"
                        style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)" }}
                        onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.background = "#0a84ff"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
                    >←</button>
                </div>

                {/* Remote pane */}
                <div className="flex-1 min-w-0" style={{ borderLeft: "0.5px solid rgba(255,255,255,0.06)" }}>
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
                        onRename={handleRemoteRename}
                        onDelete={handleRemoteDelete}
                        onMkdir={handleRemoteMkdir}
                        onRefresh={() => listRemote(remoteCwd)}
                    />
                </div>
            </div>

            {/* Bottom Progress Bar */}
            {progress && (
                <div
                    className="h-8 flex items-center px-4 shrink-0 z-10"
                    style={{
                        background: "rgba(28,28,30,0.88)",
                        backdropFilter: "blur(20px)",
                        borderTop: "0.5px solid rgba(255,255,255,0.08)",
                    }}
                >
                    <div className="flex items-center w-full max-w-2xl mx-auto gap-4">
                        <span className="text-xs truncate w-64" style={{ color: "rgba(255,255,255,0.5)" }}>{progress.file}</span>
                        <div
                            className="flex-1 h-1.5 rounded-full overflow-hidden"
                            style={{ background: "rgba(255,255,255,0.08)" }}
                        >
                            <div
                                className="h-full transition-all duration-300 ease-out rounded-full"
                                style={{
                                    width: `${(progress.bytes_done / Math.max(1, progress.bytes_total)) * 100}%`,
                                    background: "linear-gradient(90deg, #0a84ff, #64d2ff)",
                                    boxShadow: "0 0 8px rgba(10,132,255,0.5)",
                                }}
                            />
                        </div>
                        <span className="text-xs font-mono w-12 text-right" style={{ color: "rgba(255,255,255,0.7)" }}>
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
                    modal.type === 'rename' ? <Pencil size={18} style={{ color: "#0a84ff" }} /> :
                        modal.type === 'delete' ? <Trash2 size={18} style={{ color: "#ff453a" }} /> :
                            <FolderPlus size={18} style={{ color: "#0a84ff" }} />
                }
                width="w-[400px]"
            >
                <div className="flex flex-col">
                    {modal.description && (
                        <p className="text-sm mb-5" style={{ color: "rgba(255,255,255,0.5)" }}>{modal.description}</p>
                    )}

                    {(modal.type === 'rename' || modal.type === 'mkdir') && (
                        <input
                            autoFocus
                            value={modal.inputValue}
                            onChange={(e) => setModal(prev => ({ ...prev, inputValue: e.target.value }))}
                            onKeyDown={(e) => e.key === 'Enter' && handleConfirmModal(modal.inputValue)}
                            className="w-full rounded-xl px-4 py-2.5 text-sm mb-6 transition-all focus:outline-none"
                            style={{
                                background: "rgba(255,255,255,0.07)",
                                border: "0.5px solid rgba(255,255,255,0.1)",
                                color: "rgba(255,255,255,0.9)",
                            }}
                            onFocus={e => {
                                e.currentTarget.style.border = "0.5px solid #0a84ff";
                                e.currentTarget.style.boxShadow = "0 0 0 3px rgba(10,132,255,0.15)";
                            }}
                            onBlur={e => {
                                e.currentTarget.style.border = "0.5px solid rgba(255,255,255,0.1)";
                                e.currentTarget.style.boxShadow = "none";
                            }}
                            placeholder={modal.type === 'mkdir' ? 'Nome da pasta' : 'Novo nome'}
                        />
                    )}

                    <div className="flex items-center justify-end gap-3">
                        <button
                            onClick={() => setModal(prev => ({ ...prev, isOpen: false }))}
                            className="px-4 py-2 rounded-xl text-sm font-medium transition-all active:scale-[0.98]"
                            style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.75)" }}
                        >
                            Cancelar
                        </button>
                        <button
                            onClick={() => handleConfirmModal(modal.inputValue)}
                            className="px-6 py-2 rounded-xl text-sm font-medium text-white transition-all active:scale-[0.98]"
                            style={{
                                background: modal.type === 'delete' ? '#ff453a' : '#0a84ff',
                                boxShadow: modal.type === 'delete'
                                    ? '0 4px 12px rgba(255,69,58,0.3)'
                                    : '0 4px 12px rgba(10,132,255,0.3)',
                            }}
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
