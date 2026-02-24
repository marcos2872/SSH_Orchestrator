import { invoke } from '@tauri-apps/api/core';

export interface Workspace {
    id: string;
    name: string;
    color: string;
}

export const getWorkspaces = async (): Promise<Workspace[]> => {
    return invoke<Workspace[]>('get_workspaces');
};

export const createWorkspace = async (name: string, color: string): Promise<Workspace> => {
    return invoke<Workspace>('create_workspace', { name, color });
};

export const updateWorkspace = async (id: string, name: string, color: string): Promise<void> => {
    return invoke<void>('update_workspace', { id, name, color });
};

export const deleteWorkspace = async (id: string): Promise<void> => {
    return invoke<void>('delete_workspace', { id });
};
