import { invoke } from '@tauri-apps/api/core';

export const sshConnect = async (serverId: string, password?: string | null, sessionId?: string): Promise<string> => {
    const sid = sessionId || crypto.randomUUID();
    await invoke<void>('ssh_connect', {
        serverId,
        password: password || null,
        sessionId: sid,
    });
    return sid;
};

export const sshWrite = async (sessionId: string, data: string): Promise<void> => {
    return invoke<void>('ssh_write', { sessionId, data });
};

export const sshDisconnect = async (sessionId: string): Promise<void> => {
    return invoke<void>('ssh_disconnect', { sessionId });
};
