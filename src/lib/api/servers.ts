import { invoke } from '@tauri-apps/api/core';

export interface Server {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    has_saved_password: boolean;
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
    savePassword?: boolean
): Promise<Server> => {
    return invoke<Server>('create_server', {
        workspaceId,
        name,
        host,
        port,
        username,
        password: password || null,
        savePassword: savePassword || false,
    });
};

export const updateServer = async (
    id: string,
    name: string,
    host: string,
    port: number,
    username: string,
    password?: string | null,
    savePassword?: boolean
): Promise<void> => {
    return invoke<void>('update_server', {
        id,
        name,
        host,
        port,
        username,
        password: password || null,
        savePassword: savePassword || false,
    });
};

export const deleteServer = async (id: string): Promise<void> => {
    return invoke<void>('delete_server', { id });
};

export const getServerPassword = async (serverId: string): Promise<string | null> => {
    return invoke<string | null>('get_server_password', { serverId });
};
