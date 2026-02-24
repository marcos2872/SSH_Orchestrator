import { invoke } from '@tauri-apps/api/core';

export const sshConnect = async (serverId: string, password?: string | null): Promise<string> => {
    return invoke<string>('ssh_connect', {
        serverId,
        password: password || null,
    });
};

export const sshWrite = async (sessionId: string, data: string): Promise<void> => {
    return invoke<void>('ssh_write', { sessionId, data });
};

export const sshDisconnect = async (sessionId: string): Promise<void> => {
    return invoke<void>('ssh_disconnect', { sessionId });
};
