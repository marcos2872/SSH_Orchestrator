import { invoke } from "@tauri-apps/api/core";

export interface Workspace {
  id: string;
  name: string;
  color: string;
  sync_enabled?: boolean;
}

export const getWorkspaces = async (): Promise<Workspace[]> => {
  return invoke<Workspace[]>("get_workspaces");
};

export const createWorkspace = async (
  name: string,
  color: string,
): Promise<Workspace> => {
  return invoke<Workspace>("create_workspace", { name, color });
};

export const updateWorkspace = async (
  id: string,
  name: string,
  color: string,
  syncEnabled?: boolean,
): Promise<void> => {
  return invoke<void>("update_workspace", { id, name, color, syncEnabled });
};

export const deleteWorkspace = async (id: string): Promise<void> => {
  return invoke<void>("delete_workspace", { id });
};

export const pullWorkspace = async (): Promise<void> => {
  return invoke<void>("pull_workspace");
};

export const pushWorkspace = async (): Promise<void> => {
  return invoke<void>("push_workspace");
};
