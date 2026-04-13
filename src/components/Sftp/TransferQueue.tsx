import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import type { QueueItem } from '../../hooks/useSftpQueue';

interface Props {
    queue: QueueItem[];
    onCancel: (id: string) => void;
    onClearDone: () => void;
}

const fmt = (bytes: number) => {
    if (bytes === 0) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

const statusColor: Record<QueueItem['status'], string> = {
    pending: 'rgba(255,255,255,0.3)',
    active: '#0a84ff',
    done: '#30d158',
    error: '#ff453a',
};

const statusIcon: Record<QueueItem['status'], string> = {
    pending: '⏳',
    active: '⟳',
    done: '✓',
    error: '✕',
};

const TransferQueue: React.FC<Props> = ({ queue, onCancel, onClearDone }) => {
    const [collapsed, setCollapsed] = useState(false);
    const prevLengthRef = useRef(queue.length);

    // Auto-expand when a new item is enqueued
    useEffect(() => {
        if (queue.length > prevLengthRef.current) {
            setCollapsed(false);
        }
        prevLengthRef.current = queue.length;
    }, [queue.length]);

    if (queue.length === 0) return null;

    const activeCount = queue.filter(i => i.status === 'active' || i.status === 'pending').length;
    const doneCount = queue.filter(i => i.status === 'done' || i.status === 'error').length;

    return (
        <div
            className="shrink-0"
            style={{
                borderTop: '0.5px solid rgba(255,255,255,0.08)',
                background: 'rgba(18,18,20,0.95)',
                backdropFilter: 'blur(20px)',
            }}
        >
            {/* Header */}
            <div
                className="flex items-center justify-between px-4 py-2 cursor-pointer select-none"
                onClick={() => setCollapsed(c => !c)}
                style={{ borderBottom: collapsed ? 'none' : '0.5px solid rgba(255,255,255,0.06)' }}
            >
                <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.7)' }}>
                        Transferências
                    </span>
                    {activeCount > 0 && (
                        <span
                            className="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
                            style={{ background: 'rgba(10,132,255,0.2)', color: '#0a84ff' }}
                        >
                            {activeCount} ativa{activeCount !== 1 ? 's' : ''}
                        </span>
                    )}
                    {doneCount > 0 && activeCount === 0 && (
                        <span
                            className="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
                            style={{ background: 'rgba(48,209,88,0.15)', color: '#30d158' }}
                        >
                            {doneCount} concluída{doneCount !== 1 ? 's' : ''}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {doneCount > 0 && (
                        <button
                            onClick={e => { e.stopPropagation(); onClearDone(); }}
                            className="text-[10px] px-2 py-0.5 rounded-lg transition-colors"
                            style={{ color: 'rgba(255,255,255,0.35)' }}
                            onMouseEnter={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; }}
                            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.35)'; e.currentTarget.style.background = 'transparent'; }}
                        >
                            Limpar
                        </button>
                    )}
                    <span style={{ color: 'rgba(255,255,255,0.3)' }}>
                        {collapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </span>
                </div>
            </div>

            {/* Item list */}
            {!collapsed && (
                <div className="max-h-44 overflow-y-auto">
                    {queue.map(item => (
                        <div
                            key={item.id}
                            className="flex items-center gap-3 px-4 py-2"
                            style={{ borderBottom: '0.5px solid rgba(255,255,255,0.04)' }}
                        >
                            {/* Direction arrow */}
                            <span
                                className="shrink-0 text-xs font-mono w-4 text-center"
                                style={{ color: statusColor[item.status] }}
                            >
                                {item.direction === 'upload' ? '↑' : '↓'}
                            </span>

                            {/* Name + bar */}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2 mb-1">
                                    <span
                                        className="text-xs font-mono truncate"
                                        style={{ color: 'rgba(255,255,255,0.7)', maxWidth: '200px' }}
                                    >
                                        {item.isDir ? '📂 ' : ''}{item.name}
                                    </span>
                                    <span
                                        className="text-[10px] shrink-0"
                                        style={{ color: statusColor[item.status] }}
                                    >
                                        {item.status === 'active'
                                            ? `${item.progress}%`
                                            : item.status === 'done'
                                            ? fmt(item.bytesTotal)
                                            : item.status === 'error'
                                            ? 'Erro'
                                            : 'Pendente'}
                                    </span>
                                </div>

                                {/* Progress bar */}
                                <div
                                    className="h-1 rounded-full overflow-hidden"
                                    style={{ background: 'rgba(255,255,255,0.06)' }}
                                >
                                    <div
                                        className="h-full rounded-full transition-all duration-200"
                                        style={{
                                            width: `${item.status === 'done' ? 100 : item.status === 'error' ? 100 : item.progress}%`,
                                            background:
                                                item.status === 'error'
                                                    ? '#ff453a'
                                                    : item.status === 'done'
                                                    ? '#30d158'
                                                    : 'linear-gradient(90deg,#0a84ff,#64d2ff)',
                                        }}
                                    />
                                </div>

                                {/* Error message */}
                                {item.status === 'error' && item.error && (
                                    <p
                                        className="text-[10px] mt-0.5 truncate"
                                        style={{ color: '#ff453a' }}
                                        title={item.error}
                                    >
                                        {item.error}
                                    </p>
                                )}
                            </div>

                            {/* Status icon / cancel button */}
                            <div className="shrink-0 w-5 flex items-center justify-center">
                                {item.status === 'pending' ? (
                                    <button
                                        onClick={() => onCancel(item.id)}
                                        title="Cancelar"
                                        className="transition-colors"
                                        style={{ color: 'rgba(255,255,255,0.25)' }}
                                        onMouseEnter={e => { e.currentTarget.style.color = '#ff453a'; }}
                                        onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.25)'; }}
                                    >
                                        <X size={12} />
                                    </button>
                                ) : (
                                    <span
                                        className="text-xs"
                                        style={{ color: statusColor[item.status] }}
                                    >
                                        {statusIcon[item.status]}
                                    </span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default TransferQueue;
