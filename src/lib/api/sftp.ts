import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export interface SftpEntry {
    name: string;
    path: string;
    is_dir: boolean;
    size: number;
    modified?: number; // unix timestamp in seconds
}

export interface SftpProgress {
    session_id: string;
    file: string;
    bytes_done: number;
    bytes_total: number;
}

export const sftpOpenSession = (sessionId: string) =>
    invoke<string>('sftp_open_session', { sessionId });

export const sftpListDir = (sessionId: string, path: string) =>
    invoke<SftpEntry[]>('sftp_list_dir', { sessionId, path });

export const sftpUpload = (sessionId: string, localPath: string, remotePath: string) =>
    invoke<void>('sftp_upload', { sessionId, localPath, remotePath });

export const sftpDownload = (sessionId: string, remotePath: string, localPath: string) =>
    invoke<void>('sftp_download', { sessionId, remotePath, localPath });

export const sftpDelete = (sessionId: string, path: string) =>
    invoke<void>('sftp_delete', { sessionId, path });

export const sftpRename = (sessionId: string, from: string, to: string) =>
    invoke<void>('sftp_rename', { sessionId, from, to });

export const sftpMkdir = (sessionId: string, path: string) =>
    invoke<void>('sftp_mkdir', { sessionId, path });

export const sftpCloseSession = (sessionId: string) =>
    invoke<void>('sftp_close_session', { sessionId });

/** Subscribe to upload/download progress for a session. Returns unlisten fn. */
export const onSftpProgress = (
    sessionId: string,
    callback: (p: SftpProgress) => void,
) => listen<SftpProgress>(`sftp://progress/${sessionId}`, (e) => callback(e.payload));

/** Connect SSH+SFTP directly without a shell (for dual-pane SFTP tab).
 *  Credentials are resolved server-side from the vault.
 *  Pass `password` only when the user types one at the manual prompt. */
export const sftpDirectConnect = (serverId: string, password?: string | null) =>
    invoke<string>('sftp_direct_connect', { serverId, password: password ?? null });

export interface LocalEntry {
    name: string;
    path: string;
    is_dir: boolean;
    size: number;
}

/** List local filesystem directory. */
export const sftpListLocal = (path: string) =>
    invoke<LocalEntry[]>('sftp_list_local', { path });

/** Get the remote home directory for a given SFTP session (realpath(".")). */
export const sftpWorkdir = (sessionId: string) =>
    invoke<string>('sftp_workdir', { sessionId });

/** Get the local home directory ($HOME). */
export const sftpHomeDir = () =>
    invoke<string>('sftp_home_dir');

export const sftpDeleteLocal = (path: string) =>
    invoke<void>('sftp_delete_local', { path });

export const sftpRenameLocal = (from: string, to: string) =>
    invoke<void>('sftp_rename_local', { from, to });

export const sftpMkdirLocal = (path: string) =>
    invoke<void>('sftp_mkdir_local', { path });
