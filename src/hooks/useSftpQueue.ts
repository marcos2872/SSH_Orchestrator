import { useCallback, useEffect, useRef, useState } from 'react';
import {
    onSftpProgress,
    sftpDownloadRecursive,
    sftpUploadRecursive,
    type SftpProgress,
} from '../lib/api/sftp';

// ─── Types ────────────────────────────────────────────────────────────────────

export type QueueItemStatus = 'pending' | 'active' | 'done' | 'error';

export interface QueueItem {
    id: string;
    direction: 'upload' | 'download';
    /** Display name (file or folder name) */
    name: string;
    srcPath: string;
    destPath: string;
    isDir: boolean;
    status: QueueItemStatus;
    /** 0–100 */
    progress: number;
    bytesTotal: number;
    bytesDone: number;
    error?: string;
}

type EnqueueInput = Pick<
    QueueItem,
    'direction' | 'name' | 'srcPath' | 'destPath' | 'isDir'
>;

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Manages a sequential SFTP transfer queue.
 *
 * @param sftpId   Active SFTP session id (null while connecting)
 * @param onDone   Called after each transfer completes (success or error),
 *                 so callers can refresh directory listings.
 */
export function useSftpQueue(
    sftpId: string | null,
    onDone: () => void,
) {
    const [queue, setQueue] = useState<QueueItem[]>([]);
    const processingRef = useRef(false);
    const onDoneRef = useRef(onDone);
    useEffect(() => { onDoneRef.current = onDone; }, [onDone]);

    // ── Progress listener ─────────────────────────────────────────────────────
    useEffect(() => {
        if (!sftpId) return;
        let cancelled = false;
        let unlistenFn: (() => void) | null = null;

        onSftpProgress(sftpId, (p: SftpProgress) => {
            if (cancelled) return;
            setQueue(prev =>
                prev.map(item =>
                    item.status === 'active'
                        ? {
                              ...item,
                              bytesDone: p.bytes_done,
                              bytesTotal: p.bytes_total,
                              progress:
                                  p.bytes_total > 0
                                      ? Math.min(
                                            99,
                                            Math.round((p.bytes_done / p.bytes_total) * 100),
                                        )
                                      : 0,
                          }
                        : item,
                ),
            );
        }).then(fn => {
            if (cancelled) fn();
            else unlistenFn = fn;
        });

        return () => {
            cancelled = true;
            unlistenFn?.();
        };
    }, [sftpId]);

    // ── Queue processor ───────────────────────────────────────────────────────
    useEffect(() => {
        if (!sftpId || processingRef.current) return;

        const pending = queue.find(i => i.status === 'pending');
        if (!pending) return;

        processingRef.current = true;

        // Mark item as active
        setQueue(prev =>
            prev.map(i => (i.id === pending.id ? { ...i, status: 'active' } : i)),
        );

        const transfer =
            pending.direction === 'upload'
                ? sftpUploadRecursive(sftpId, pending.srcPath, pending.destPath)
                : sftpDownloadRecursive(sftpId, pending.srcPath, pending.destPath);

        transfer
            .then(() => {
                setQueue(prev =>
                    prev.map(i =>
                        i.id === pending.id ? { ...i, status: 'done', progress: 100 } : i,
                    ),
                );
                onDoneRef.current();
            })
            .catch((err: unknown) => {
                setQueue(prev =>
                    prev.map(i =>
                        i.id === pending.id
                            ? { ...i, status: 'error', error: String(err) }
                            : i,
                    ),
                );
                onDoneRef.current();
            })
            .finally(() => {
                processingRef.current = false;
            });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [queue, sftpId]);

    // ── Public API ────────────────────────────────────────────────────────────

    const enqueue = useCallback((items: EnqueueInput[]) => {
        const newItems: QueueItem[] = items.map(item => ({
            ...item,
            id: crypto.randomUUID(),
            status: 'pending',
            progress: 0,
            bytesTotal: 0,
            bytesDone: 0,
        }));
        setQueue(prev => [...prev, ...newItems]);
    }, []);

    const cancelPending = useCallback((id: string) => {
        setQueue(prev => prev.filter(i => !(i.id === id && i.status === 'pending')));
    }, []);

    const clearDone = useCallback(() => {
        setQueue(prev => prev.filter(i => i.status === 'pending' || i.status === 'active'));
    }, []);

    const isProcessing = processingRef.current || queue.some(i => i.status === 'active');

    return { queue, enqueue, cancelPending, clearDone, isProcessing };
}
