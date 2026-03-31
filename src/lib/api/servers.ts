import { invoke } from '@tauri-apps/api/core';

export interface Server {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    has_saved_password: boolean;
    has_saved_ssh_key: boolean;
    has_saved_ssh_key_passphrase: boolean;
}

export const getServers = async (workspaceId: string): Promise<Server[]> => {
    return invoke<Server[]>('get_servers', { workspaceId });
};

export const createServer = async (
    workspaceId: string,
    name: string,
    host: string,
    port: number,
    username: string,
    password?: string | null,
    savePassword?: boolean,
    sshKey?: string | null,
    saveSshKey?: boolean,
    sshKeyPassphrase?: string | null,
    saveSshKeyPassphrase?: boolean,
): Promise<Server> => {
    return invoke<Server>('create_server', {
        workspaceId,
        name,
        host,
        port,
        username,
        password: password || null,
        savePassword: savePassword ?? false,
        sshKey: sshKey || null,
        saveSshKey: saveSshKey ?? false,
        sshKeyPassphrase: sshKeyPassphrase || null,
        saveSshKeyPassphrase: saveSshKeyPassphrase ?? false,
    });
};

export const updateServer = async (
    id: string,
    name: string,
    host: string,
    port: number,
    username: string,
    password?: string | null,
    savePassword?: boolean,
    sshKey?: string | null,
    saveSshKey?: boolean,
    sshKeyPassphrase?: string | null,
    saveSshKeyPassphrase?: boolean,
): Promise<void> => {
    return invoke<void>('update_server', {
        id,
        name,
        host,
        port,
        username,
        password: password || null,
        savePassword: savePassword ?? false,
        sshKey: sshKey || null,
        saveSshKey: saveSshKey ?? false,
        sshKeyPassphrase: sshKeyPassphrase || null,
        saveSshKeyPassphrase: saveSshKeyPassphrase ?? false,
    });
};

export const deleteServer = async (id: string): Promise<void> => {
    return invoke<void>('delete_server', { id });
};
