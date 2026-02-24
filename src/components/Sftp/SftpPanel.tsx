import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    sftpOpenSession, sftpListDir, sftpUpload, sftpDownload,
    sftpDelete, sftpRename, sftpMkdir, sftpCloseSession,
    onSftpProgress, type SftpEntry, type SftpProgress,
} from '../../lib/api/sftp';

interface Props {
    sessionId: string | null; // active SSH session id to piggyback on
    onClose: () => void;
}

interface Transfer {
    file: string;
    progress: number; // 0–100
    done: boolean;
}

const SftpPanel: React.FC<Props> = ({ sessionId, onClose }) => {
    const [sftpSessionId, setSftpSessionId] = useState<string | null>(null);
    const [cwd, setCwd] = useState('/');
    const [entries, setEntries] = useState<SftpEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [transfers, setTransfers] = useState<Transfer[]>([]);
    const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; entry: SftpEntry } | null>(null);
    const [renaming, setRenaming] = useState<{ entry: SftpEntry; newName: string } | null>(null);
    const unlistenRef = useRef<(() => void) | null>(null);

    // ── Open SFTP session ──────────────────────────────────────────────────────
    useEffect(() => {
        if (!sessionId) return;
        let cancelled = false;
        (async () => {
            try {
                const id = await sftpOpenSession(sessionId);
                if (cancelled) { sftpCloseSession(id); return; }
                setSftpSessionId(id);
                // Subscribe to progress events
                const unlisten = await onSftpProgress(id, (p: SftpProgress) => {
                    const pct = p.bytes_total > 0 ? Math.round((p.bytes_done / p.bytes_total) * 100) : 0;
                    setTransfers(prev => {
                        const existing = prev.find(t => t.file === p.file);
                        if (existing) return prev.map(t => t.file === p.file ? { ...t, progress: pct, done: pct >= 100 } : t);
                        return [...prev, { file: p.file, progress: pct, done: false }];
                    });
                });
                unlistenRef.current = unlisten;
            } catch (e) {
                if (!cancelled) setError(String(e));
            }
        })();
        return () => {
            cancelled = true;
            unlistenRef.current?.();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId]);

    // ── Cleanup SFTP session on unmount ───────────────────────────────────────
    useEffect(() => {
        return () => {
            if (sftpSessionId) sftpCloseSession(sftpSessionId);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sftpSessionId]);

    // ── List directory ─────────────────────────────────────────────────────────
    const listDir = useCallback(async (path: string) => {
        if (!sftpSessionId) return;
        setLoading(true);
        setError(null);
        try {
            const result = await sftpListDir(sftpSessionId, path);
            const sorted = [...result].sort((a, b) => {
                if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
            setEntries(sorted);
            setCwd(path);
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }, [sftpSessionId]);

    useEffect(() => {
        if (sftpSessionId) listDir(cwd);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sftpSessionId]);

    // ── Drag & Drop upload ─────────────────────────────────────────────────────
    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        if (!sftpSessionId) return;
        const files = Array.from(e.dataTransfer.files);
        for (const file of files) {
            const localPath = (file as File & { path?: string }).path ?? '';
            if (!localPath) continue;
            const remotePath = `${cwd.replace(/\/$/, '')}/${file.name}`;
            try {
                await sftpUpload(sftpSessionId, localPath, remotePath);
                setTransfers(prev => prev.map(t =>
                    t.file === file.name ? { ...t, done: true, progress: 100 } : t
                ));
            } catch (e) {
                setError(String(e));
            }
        }
        await listDir(cwd);
    }, [sftpSessionId, cwd, listDir]);

    // ── Context menu actions ───────────────────────────────────────────────────
    const handleDelete = async (entry: SftpEntry) => {
        if (!sftpSessionId) return;
        try {
            await sftpDelete(sftpSessionId, entry.path);
            await listDir(cwd);
        } catch (e) { setError(String(e)); }
        setCtxMenu(null);
    };

    const handleRenameSubmit = async () => {
        if (!sftpSessionId || !renaming) return;
        const parent = renaming.entry.path.split('/').slice(0, -1).join('/') || '/';
        const to = `${parent}/${renaming.newName}`;
        try {
            await sftpRename(sftpSessionId, renaming.entry.path, to);
            await listDir(cwd);
        } catch (e) { setError(String(e)); }
        setRenaming(null);
        setCtxMenu(null);
    };

    const handleMkdir = async () => {
        if (!sftpSessionId) return;
        const name = prompt('Nome da nova pasta:');
        if (!name) return;
        try {
            await sftpMkdir(sftpSessionId, `${cwd.replace(/\/$/, '')}/${name}`);
            await listDir(cwd);
        } catch (e) { setError(String(e)); }
    };

    // ── Breadcrumb ─────────────────────────────────────────────────────────────
    const breadcrumbs = cwd.split('/').filter(Boolean);

    const formatSize = (bytes: number) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    };

    const activeTransfers = transfers.filter(t => !t.done);

    return (
        <div
            className="flex flex-col h-full bg-slate-950 border-l border-slate-800 text-sm"
            onClick={() => setCtxMenu(null)}
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 shrink-0">
                <span className="font-semibold text-slate-300 flex items-center gap-2">
                    <span>📁</span> SFTP
                </span>
                <div className="flex gap-2">
                    <button
                        onClick={handleMkdir}
                        className="text-xs text-slate-400 hover:text-white px-2 py-0.5 rounded hover:bg-slate-800 transition-colors"
                        title="Nova pasta"
                    >＋ Pasta</button>
                    <button
                        onClick={() => listDir(cwd)}
                        className="text-xs text-slate-400 hover:text-white px-2 py-0.5 rounded hover:bg-slate-800 transition-colors"
                        title="Atualizar"
                    >↻</button>
                    <button onClick={onClose} className="text-slate-500 hover:text-red-400 transition-colors">✕</button>
                </div>
            </div>

            {/* Breadcrumb */}
            <div className="flex items-center gap-1 px-3 py-1.5 border-b border-slate-800 shrink-0 overflow-x-auto">
                <button
                    onClick={() => listDir('/')}
                    className="text-xs text-sky-400 hover:text-sky-300 font-mono shrink-0"
                >/</button>
                {breadcrumbs.map((seg, i) => {
                    const path = '/' + breadcrumbs.slice(0, i + 1).join('/');
                    return (
                        <React.Fragment key={path}>
                            <span className="text-slate-600 shrink-0">/</span>
                            <button
                                onClick={() => listDir(path)}
                                className="text-xs text-sky-400 hover:text-sky-300 font-mono shrink-0"
                            >{seg}</button>
                        </React.Fragment>
                    );
                })}
            </div>

            {/* Active transfers */}
            {activeTransfers.length > 0 && (
                <div className="px-3 py-2 border-b border-slate-800 shrink-0 space-y-1">
                    {activeTransfers.map(t => (
                        <div key={t.file}>
                            <div className="flex justify-between text-xs text-slate-400 mb-0.5">
                                <span className="truncate max-w-[160px]">{t.file}</span>
                                <span>{t.progress}%</span>
                            </div>
                            <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-sky-500 transition-all duration-200 rounded-full"
                                    style={{ width: `${t.progress}%` }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* File list */}
            <div className="flex-1 overflow-y-auto">
                {loading && (
                    <div className="flex items-center justify-center h-20 text-slate-500">
                        <span className="animate-pulse">Carregando...</span>
                    </div>
                )}
                {error && (
                    <div className="p-3 text-xs text-red-400 bg-red-950/20">⚠ {error}</div>
                )}
                {!loading && !sessionId && (
                    <div className="flex items-center justify-center h-full text-slate-600 text-xs px-4 text-center">
                        Conecte-se via SSH primeiro para usar o SFTP
                    </div>
                )}
                {!loading && sftpSessionId && entries.length === 0 && (
                    <div className="flex items-center justify-center h-20 text-slate-600 text-xs">
                        Pasta vazia
                    </div>
                )}
                {!loading && entries.map(entry => (
                    <div
                        key={entry.path}
                        className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-900 cursor-pointer select-none group"
                        onDoubleClick={() => entry.is_dir ? listDir(entry.path) : null}
                        onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, entry }); }}
                    >
                        <span className="shrink-0">{entry.is_dir ? '📂' : '📄'}</span>
                        <span className="flex-1 truncate text-xs text-slate-200 font-mono">{entry.name}</span>
                        {!entry.is_dir && (
                            <span className="text-xs text-slate-600 shrink-0">{formatSize(entry.size)}</span>
                        )}
                    </div>
                ))}
            </div>

            {/* Drop zone hint */}
            <div className="px-3 py-2 border-t border-slate-800 text-xs text-slate-600 text-center shrink-0">
                Arraste arquivos aqui para fazer upload
            </div>

            {/* Context menu */}
            {ctxMenu && (
                <div
                    className="fixed z-50 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-1 w-44"
                    style={{ top: ctxMenu.y, left: ctxMenu.x }}
                    onClick={e => e.stopPropagation()}
                >
                    {!ctxMenu.entry.is_dir && (
                        <button
                            className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                            onClick={async () => {
                                if (!sftpSessionId) return;
                                const { remote, local } = { remote: ctxMenu.entry.path, local: `/tmp/${ctxMenu.entry.name}` };
                                await sftpDownload(sftpSessionId, remote, local).catch(e => setError(String(e)));
                                setCtxMenu(null);
                            }}
                        >⬇ Fazer download</button>
                    )}
                    <button
                        className="w-full text-left px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                        onClick={() => {
                            setRenaming({ entry: ctxMenu.entry, newName: ctxMenu.entry.name });
                        }}
                    >✏️ Renomear</button>
                    <button
                        className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-red-950/30 hover:text-red-300 transition-colors"
                        onClick={() => handleDelete(ctxMenu.entry)}
                    >🗑 Excluir</button>
                </div>
            )}

            {/* Rename dialog */}
            {renaming && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
                    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-80 shadow-2xl">
                        <h3 className="text-sm font-semibold mb-3">Renomear</h3>
                        <input
                            autoFocus
                            value={renaming.newName}
                            onChange={e => setRenaming({ ...renaming, newName: e.target.value })}
                            onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') setRenaming(null); }}
                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-sky-500"
                        />
                        <div className="flex gap-2 mt-3">
                            <button onClick={() => setRenaming(null)} className="flex-1 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs rounded-lg transition-colors">Cancelar</button>
                            <button onClick={handleRenameSubmit} className="flex-1 py-1.5 bg-sky-600 hover:bg-sky-500 text-xs rounded-lg transition-colors">Renomear</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SftpPanel;
