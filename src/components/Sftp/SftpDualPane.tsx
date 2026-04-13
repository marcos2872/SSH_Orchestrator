import React, { useState, useEffect, useCallback, useRef } from 'react';
import Modal from '../Modal';
import {
    sftpDirectConnect, sftpListDir, sftpListLocal,
    sftpCloseSession, sftpWorkdir, sftpHomeDir,
    sftpDelete, sftpRename, sftpMkdir,
    sftpDeleteLocal, sftpRenameLocal, sftpMkdirLocal,
    type SftpEntry, type LocalEntry,
} from '../../lib/api/sftp';
import { useSftpQueue } from '../../hooks/useSftpQueue';
import TransferQueue from './TransferQueue';
import type { Server } from '../../hooks/useTerminalManager';
import { FolderPlus, Trash2, Pencil, RefreshCw } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DragItem {
    side: 'local' | 'remote';
    paths: string[]; // one or more selected paths
    name: string;    // display name (first item or "N itens")
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
    selected: Set<string>;
    lastSelected: string | null;
    onSelect: (path: string, e: React.MouseEvent) => void;
    onNavigate: (path: string) => void;
    onDragStart: (item: DragItem) => void;
    onDrop: (target: 'local' | 'remote', targetDir: string) => void;
    onDragOver: (e: React.DragEvent, side: 'local' | 'remote') => void;
    onRename: (path: string) => void;
    onDelete: (paths: string[]) => void;
    onMkdir: () => void;
    onRefresh: () => void;
}

const FilePane: React.FC<PaneProps> = ({
    title, icon, cwd, entries, loading, error, side,
    dropTarget, selected, lastSelected: _lastSelected, onSelect, onNavigate,
    onDragStart, onDrop, onDragOver,
    onRename, onDelete, onMkdir, onRefresh,
}) => {
    const parent = cwd.split('/').slice(0, -1).join('/') || '/';
    const segments = cwd.split('/').filter(Boolean);
    const selCount = selected.size;

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
                    {selCount > 1 && (
                        <span
                            className="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
                            style={{ background: 'rgba(10,132,255,0.2)', color: '#0a84ff' }}
                        >
                            {selCount} selecionados
                        </span>
                    )}
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
                        onClick={() => selCount === 1 && onRename([...selected][0])}
                        disabled={selCount !== 1}
                        title="Renomear"
                        className="p-1 rounded-lg transition-colors disabled:opacity-30"
                        style={{ color: "rgba(255,255,255,0.4)" }}
                        onMouseEnter={e => { if (!e.currentTarget.disabled) { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#0a84ff"; } }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.4)"; }}
                    >
                        <Pencil size={14} />
                    </button>
                    <button
                        onClick={() => selCount > 0 && onDelete([...selected])}
                        disabled={selCount === 0}
                        title={selCount > 1 ? `Deletar ${selCount} itens` : 'Deletar'}
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

                {!loading && entries.map((entry, idx) => {
                    const isSelected = selected.has(entry.path);
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
                            onClick={e => onSelect(entry.path, e)}
                            onDoubleClick={() => entry.is_dir && onNavigate(entry.path)}
                            draggable
                            onDragStart={() => {
                                const paths = isSelected ? [...selected] : [entry.path];
                                const name = paths.length === 1 ? entry.name : `${paths.length} itens`;
                                onDragStart({ side, paths, name, is_dir: entry.is_dir });
                            }}
                            data-index={idx}
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
    const [localSelected, setLocalSelected] = useState<Set<string>>(new Set());
    const [localLastSelected, setLocalLastSelected] = useState<string | null>(null);

    // Remote pane
    const [remoteCwd, setRemoteCwd] = useState('/');
    const [remoteEntries, setRemoteEntries] = useState<SftpEntry[]>([]);
    const [remoteLoading, setRemoteLoading] = useState(false);
    const [remoteError, setRemoteError] = useState<string | null>(null);
    const [remoteSelected, setRemoteSelected] = useState<Set<string>>(new Set());
    const [remoteLastSelected, setRemoteLastSelected] = useState<string | null>(null);

    // Drag & drop
    const [dragging, setDragging] = useState<DragItem | null>(null);
    const [dropSide, setDropSide] = useState<'local' | 'remote' | null>(null);

    // Transfer queue
    const onTransferDone = useCallback(() => {
        listLocal(localCwd);
        listRemote(remoteCwd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [localCwd, remoteCwd]);
    const { queue, enqueue, cancelPending, clearDone } = useSftpQueue(sftp, onTransferDone);

    // Modal state
    interface ModalState {
        isOpen: boolean;
        type: 'rename' | 'delete' | 'mkdir';
        side: 'local' | 'remote';
        targetPath?: string;
        targetPaths?: string[];
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

    // ── Subscribe to progress + cleanup session on unmount ─────────────────────
    useEffect(() => {
        if (!sftp) return;
        return () => {
            sftpCloseSession(sftp);
        };
    }, [sftp]);

    // ── Selection helpers ─────────────────────────────────────────
    const makeSelectHandler = useCallback((
        entries: Array<{ path: string }>,
        setSelected: React.Dispatch<React.SetStateAction<Set<string>>>,
        getLastSelected: () => string | null,
        setLastSelected: React.Dispatch<React.SetStateAction<string | null>>,
    ) => (path: string, e: React.MouseEvent) => {
        const ctrl = e.ctrlKey || e.metaKey;
        const shift = e.shiftKey;

        if (shift) {
            const last = getLastSelected();
            if (last) {
                const paths = entries.map(en => en.path);
                const a = paths.indexOf(last);
                const b = paths.indexOf(path);
                const [from, to] = a < b ? [a, b] : [b, a];
                const range = new Set(paths.slice(from, to + 1));
                setSelected(range);
            } else {
                setSelected(new Set([path]));
                setLastSelected(path);
            }
        } else if (ctrl) {
            setSelected(prev => {
                const next = new Set(prev);
                if (next.has(path)) next.delete(path);
                else next.add(path);
                return next;
            });
            setLastSelected(path);
        } else {
            setSelected(new Set([path]));
            setLastSelected(path);
        }
    }, []);

    const handleLocalSelect = useCallback(
        (path: string, e: React.MouseEvent) =>
            makeSelectHandler(
                localEntries,
                setLocalSelected,
                () => localLastSelected,
                setLocalLastSelected,
            )(path, e),
        [makeSelectHandler, localEntries, localLastSelected],
    );

    const handleRemoteSelect = useCallback(
        (path: string, e: React.MouseEvent) =>
            makeSelectHandler(
                remoteEntries,
                setRemoteSelected,
                () => remoteLastSelected,
                setRemoteLastSelected,
            )(path, e),
        [makeSelectHandler, remoteEntries, remoteLastSelected],
    );

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
        if (!dragging || dragging.side === targetSide || !sftp) return;

        if (targetSide === 'remote') {
            enqueue(dragging.paths.map(p => {
                const name = p.split('/').pop() ?? p;
                return {
                    direction: 'upload' as const,
                    name,
                    srcPath: p,
                    destPath: `${targetDir.replace(/\/$/, '')}/${name}`,
                    isDir: dragging.is_dir,
                };
            }));
        } else {
            enqueue(dragging.paths.map(p => {
                const name = p.split('/').pop() ?? p;
                return {
                    direction: 'download' as const,
                    name,
                    srcPath: p,
                    destPath: `${targetDir.replace(/\/$/, '')}/${name}`,
                    isDir: dragging.is_dir,
                };
            }));
        }
        setDragging(null);
    }, [dragging, sftp, enqueue]);

    const handleConfirmModal = async (value: string) => {
        const { type, side, targetPath, targetPaths } = modal;
        setModal(prev => ({ ...prev, isOpen: false }));

        try {
            if (side === 'local') {
                if (type === 'rename' && targetPath) {
                    const parent = targetPath.split('/').slice(0, -1).join('/') || '/';
                    const newPath = `${parent.replace(/\/$/, '')}/${value}`;
                    await sftpRenameLocal(targetPath, newPath);
                } else if (type === 'delete') {
                    const paths = targetPaths ?? (targetPath ? [targetPath] : []);
                    for (const p of paths) await sftpDeleteLocal(p);
                    setLocalSelected(new Set());
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
                } else if (type === 'delete') {
                    const paths = targetPaths ?? (targetPath ? [targetPath] : []);
                    for (const p of paths) await sftpDelete(sftp, p);
                    setRemoteSelected(new Set());
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

    const handleLocalDelete = useCallback((paths: string[]) => {
        const name = paths.length === 1
            ? (paths[0].split('/').pop() ?? paths[0])
            : `${paths.length} itens`;
        setModal({
            isOpen: true,
            type: 'delete',
            side: 'local',
            targetPath: paths[0],
            targetPaths: paths,
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

    const handleRemoteDelete = useCallback((paths: string[]) => {
        const name = paths.length === 1
            ? (paths[0].split('/').pop() ?? paths[0])
            : `${paths.length} itens`;
        setModal({
            isOpen: true,
            type: 'delete',
            side: 'remote',
            targetPath: paths[0],
            targetPaths: paths,
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
                        lastSelected={localLastSelected}
                        onSelect={handleLocalSelect}
                        onNavigate={path => { listLocal(path); setLocalSelected(new Set()); }}
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
                        disabled={localSelected.size === 0}
                        onClick={() => {
                            if (!sftp) return;
                            enqueue([...localSelected].map(p => {
                                const entry = localEntries.find(e => e.path === p);
                                const name = p.split('/').pop() ?? p;
                                return {
                                    direction: 'upload' as const,
                                    name,
                                    srcPath: p,
                                    destPath: `${remoteCwd.replace(/\/$/, '')}/${name}`,
                                    isDir: entry?.is_dir ?? false,
                                };
                            }));
                        }}
                        className="w-7 h-7 flex items-center justify-center rounded-lg transition-all disabled:opacity-30 text-sm"
                        style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)" }}
                        onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.background = "#0a84ff"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
                    >→</button>
                    <button
                        title="Download ← (remoto para local)"
                        disabled={remoteSelected.size === 0}
                        onClick={() => {
                            if (!sftp) return;
                            enqueue([...remoteSelected].map(p => {
                                const entry = remoteEntries.find(e => e.path === p);
                                const name = p.split('/').pop() ?? p;
                                return {
                                    direction: 'download' as const,
                                    name,
                                    srcPath: p,
                                    destPath: `${localCwd.replace(/\/$/, '')}/${name}`,
                                    isDir: entry?.is_dir ?? false,
                                };
                            }));
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
                        lastSelected={remoteLastSelected}
                        onSelect={handleRemoteSelect}
                        onNavigate={path => { listRemote(path); setRemoteSelected(new Set()); }}
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

            {/* Transfer Queue */}
            <TransferQueue
                queue={queue}
                onCancel={cancelPending}
                onClearDone={clearDone}
            />

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
