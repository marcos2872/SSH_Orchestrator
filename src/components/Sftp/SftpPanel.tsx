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
    const [mkdirDialog, setMkdirDialog] = useState<{ open: boolean; value: string }>({ open: false, value: '' });
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

    const handleMkdir = () => {
        if (!sftpSessionId) return;
        setMkdirDialog({ open: true, value: '' });
    };

    const handleMkdirSubmit = async () => {
        if (!sftpSessionId || !mkdirDialog.value.trim()) return;
        setMkdirDialog({ open: false, value: '' });
        try {
            await sftpMkdir(sftpSessionId, `${cwd.replace(/\/$/, '')}/${mkdirDialog.value.trim()}`);
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
            className="flex flex-col h-full text-sm"
            style={{
                background: "#000000",
                borderLeft: "0.5px solid rgba(255,255,255,0.08)",
            }}
            onClick={() => setCtxMenu(null)}
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
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
                <span className="font-semibold flex items-center gap-2" style={{ color: "rgba(255,255,255,0.75)" }}>
                    <span>📁</span> SFTP
                </span>
                <div className="flex gap-2">
                    <button
                        onClick={handleMkdir}
                        className="text-xs px-2 py-0.5 rounded-lg transition-colors"
                        style={{ color: "rgba(255,255,255,0.4)" }}
                        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#ffffff"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.4)"; }}
                        title="Nova pasta"
                    >＋ Pasta</button>
                    <button
                        onClick={() => listDir(cwd)}
                        className="text-xs px-2 py-0.5 rounded-lg transition-colors"
                        style={{ color: "rgba(255,255,255,0.4)" }}
                        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#ffffff"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.4)"; }}
                        title="Atualizar"
                    >↻</button>
                    <button
                        onClick={onClose}
                        className="transition-colors"
                        style={{ color: "rgba(255,255,255,0.3)" }}
                        onMouseEnter={e => { e.currentTarget.style.color = "#ff453a"; }}
                        onMouseLeave={e => { e.currentTarget.style.color = "rgba(255,255,255,0.3)"; }}
                    >✕</button>
                </div>
            </div>

            {/* Breadcrumb */}
            <div
                className="flex items-center gap-1 px-3 py-1.5 shrink-0 overflow-x-auto"
                style={{ borderBottom: "0.5px solid rgba(255,255,255,0.06)" }}
            >
                <button
                    onClick={() => listDir('/')}
                    className="text-xs font-mono shrink-0 transition-colors"
                    style={{ color: "#0a84ff" }}
                >/</button>
                {breadcrumbs.map((seg, i) => {
                    const path = '/' + breadcrumbs.slice(0, i + 1).join('/');
                    return (
                        <React.Fragment key={path}>
                            <span className="text-xs shrink-0" style={{ color: "rgba(255,255,255,0.2)" }}>/</span>
                            <button
                                onClick={() => listDir(path)}
                                className="text-xs font-mono shrink-0 transition-colors"
                                style={{ color: "#0a84ff" }}
                            >{seg}</button>
                        </React.Fragment>
                    );
                })}
            </div>

            {/* Active transfers */}
            {activeTransfers.length > 0 && (
                <div
                    className="px-3 py-2 shrink-0 space-y-1"
                    style={{ borderBottom: "0.5px solid rgba(255,255,255,0.06)" }}
                >
                    {activeTransfers.map(t => (
                        <div key={t.file}>
                            <div className="flex justify-between text-xs mb-0.5" style={{ color: "rgba(255,255,255,0.5)" }}>
                                <span className="truncate max-w-[160px]">{t.file}</span>
                                <span>{t.progress}%</span>
                            </div>
                            <div className="h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.08)" }}>
                                <div
                                    className="h-full transition-all duration-200 rounded-full"
                                    style={{
                                        width: `${t.progress}%`,
                                        background: "linear-gradient(90deg, #0a84ff, #64d2ff)",
                                    }}
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* File list */}
            <div className="flex-1 overflow-y-auto">
                {loading && (
                    <div className="flex items-center justify-center h-20" style={{ color: "rgba(255,255,255,0.3)" }}>
                        <span className="animate-pulse text-xs">Carregando...</span>
                    </div>
                )}
                {error && (
                    <div className="p-3 text-xs" style={{ color: "#ff453a", background: "rgba(255,69,58,0.08)" }}>⚠ {error}</div>
                )}
                {!loading && !sessionId && (
                    <div className="flex items-center justify-center h-full text-xs px-4 text-center" style={{ color: "rgba(255,255,255,0.2)" }}>
                        Conecte-se via SSH primeiro para usar o SFTP
                    </div>
                )}
                {!loading && sftpSessionId && entries.length === 0 && (
                    <div className="flex items-center justify-center h-20 text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>
                        Pasta vazia
                    </div>
                )}
                {!loading && entries.map(entry => (
                    <div
                        key={entry.path}
                        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none transition-colors"
                        style={{ color: "rgba(255,255,255,0.75)" }}
                        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                        onDoubleClick={() => entry.is_dir ? listDir(entry.path) : null}
                        onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, entry }); }}
                    >
                        <span className="shrink-0">{entry.is_dir ? '📂' : '📄'}</span>
                        <span className="flex-1 truncate text-xs font-mono">{entry.name}</span>
                        {!entry.is_dir && (
                            <span className="text-xs shrink-0" style={{ color: "rgba(255,255,255,0.25)" }}>{formatSize(entry.size)}</span>
                        )}
                    </div>
                ))}
            </div>

            {/* Drop zone hint */}
            <div
                className="px-3 py-2 text-xs text-center shrink-0"
                style={{
                    borderTop: "0.5px solid rgba(255,255,255,0.06)",
                    color: "rgba(255,255,255,0.2)",
                }}
            >
                Arraste arquivos aqui para fazer upload
            </div>

            {/* Context menu */}
            {ctxMenu && (
                <div
                    className="fixed z-50 rounded-2xl shadow-2xl py-1 w-44"
                    style={{
                        top: ctxMenu.y,
                        left: ctxMenu.x,
                        background: "rgba(44,44,46,0.92)",
                        backdropFilter: "blur(20px) saturate(180%)",
                        WebkitBackdropFilter: "blur(20px) saturate(180%)",
                        border: "0.5px solid rgba(255,255,255,0.12)",
                    }}
                    onClick={e => e.stopPropagation()}
                >
                    {!ctxMenu.entry.is_dir && (
                        <button
                            className="w-full text-left px-3 py-1.5 text-xs transition-colors"
                            style={{ color: "rgba(255,255,255,0.75)" }}
                            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; e.currentTarget.style.color = "#ffffff"; }}
                            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.75)"; }}
                            onClick={async () => {
                                if (!sftpSessionId) return;
                                const { remote, local } = { remote: ctxMenu.entry.path, local: `/tmp/${ctxMenu.entry.name}` };
                                await sftpDownload(sftpSessionId, remote, local).catch(e => setError(String(e)));
                                setCtxMenu(null);
                            }}
                        >⬇ Fazer download</button>
                    )}
                    <button
                        className="w-full text-left px-3 py-1.5 text-xs transition-colors"
                        style={{ color: "rgba(255,255,255,0.75)" }}
                        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; e.currentTarget.style.color = "#ffffff"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.75)"; }}
                        onClick={() => {
                            setRenaming({ entry: ctxMenu.entry, newName: ctxMenu.entry.name });
                        }}
                    >✏️ Renomear</button>
                    <button
                        className="w-full text-left px-3 py-1.5 text-xs transition-colors"
                        style={{ color: "#ff453a" }}
                        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,69,58,0.1)"; e.currentTarget.style.color = "#ff6961"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#ff453a"; }}
                        onClick={() => handleDelete(ctxMenu.entry)}
                    >🗑 Excluir</button>
                </div>
            )}

            {/* Rename dialog */}
            {renaming && (
                <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }}>
                    <div
                        className="rounded-3xl p-6 w-80 shadow-2xl"
                        style={{
                            background: "rgba(28,28,30,0.95)",
                            backdropFilter: "blur(40px) saturate(180%)",
                            WebkitBackdropFilter: "blur(40px) saturate(180%)",
                            border: "0.5px solid rgba(255,255,255,0.12)",
                        }}
                    >
                        <h3 className="text-sm font-semibold mb-3">Renomear</h3>
                        <input
                            autoFocus
                            value={renaming.newName}
                            onChange={e => setRenaming({ ...renaming, newName: e.target.value })}
                            onKeyDown={e => { if (e.key === 'Enter') handleRenameSubmit(); if (e.key === 'Escape') setRenaming(null); }}
                            className="w-full rounded-xl px-3 py-2 text-sm font-mono mb-3 transition-all focus:outline-none"
                            style={{
                                background: "rgba(255,255,255,0.07)",
                                border: "0.5px solid rgba(255,255,255,0.1)",
                                color: "rgba(255,255,255,0.9)",
                            }}
                            onFocus={e => { e.currentTarget.style.border = "0.5px solid #0a84ff"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(10,132,255,0.15)"; }}
                            onBlur={e => { e.currentTarget.style.border = "0.5px solid rgba(255,255,255,0.1)"; e.currentTarget.style.boxShadow = "none"; }}
                        />
                        <div className="flex gap-2">
                            <button
                                onClick={() => setRenaming(null)}
                                className="flex-1 py-1.5 text-xs rounded-xl transition-all"
                                style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)" }}
                            >Cancelar</button>
                            <button
                                onClick={handleRenameSubmit}
                                className="flex-1 py-1.5 text-xs rounded-xl transition-all"
                                style={{ background: "#0a84ff", color: "#ffffff" }}
                            >Renomear</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Mkdir dialog */}
            {mkdirDialog.open && (
                <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }}>
                    <div
                        className="rounded-3xl p-6 w-80 shadow-2xl"
                        style={{
                            background: "rgba(28,28,30,0.95)",
                            backdropFilter: "blur(40px) saturate(180%)",
                            WebkitBackdropFilter: "blur(40px) saturate(180%)",
                            border: "0.5px solid rgba(255,255,255,0.12)",
                        }}
                    >
                        <h3 className="text-sm font-semibold mb-3">Nova Pasta</h3>
                        <input
                            autoFocus
                            value={mkdirDialog.value}
                            onChange={e => setMkdirDialog(d => ({ ...d, value: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter') handleMkdirSubmit(); if (e.key === 'Escape') setMkdirDialog({ open: false, value: '' }); }}
                            placeholder="Nome da pasta"
                            className="w-full rounded-xl px-3 py-2 text-sm font-mono mb-3 transition-all focus:outline-none"
                            style={{
                                background: "rgba(255,255,255,0.07)",
                                border: "0.5px solid rgba(255,255,255,0.1)",
                                color: "rgba(255,255,255,0.9)",
                            }}
                            onFocus={e => { e.currentTarget.style.border = "0.5px solid #0a84ff"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(10,132,255,0.15)"; }}
                            onBlur={e => { e.currentTarget.style.border = "0.5px solid rgba(255,255,255,0.1)"; e.currentTarget.style.boxShadow = "none"; }}
                        />
                        <div className="flex gap-2">
                            <button
                                onClick={() => setMkdirDialog({ open: false, value: '' })}
                                className="flex-1 py-1.5 text-xs rounded-xl transition-all"
                                style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)" }}
                            >Cancelar</button>
                            <button
                                onClick={handleMkdirSubmit}
                                disabled={!mkdirDialog.value.trim()}
                                className="flex-1 py-1.5 text-xs rounded-xl transition-all disabled:opacity-40"
                                style={{ background: "#0a84ff", color: "#ffffff" }}
                            >Criar</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SftpPanel;
