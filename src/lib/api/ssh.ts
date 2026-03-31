import { invoke } from "@tauri-apps/api/core";

export const sshConnect = async (
  serverId: string,
  password?: string | null,
  sessionId?: string,
  cols?: number,
  rows?: number,
  sshKey?: string | null,
  sshKeyPassphrase?: string | null,
): Promise<string> => {
  const sid = sessionId || crypto.randomUUID();
  await invoke<string>("ssh_connect", {
    serverId,
    password: password || null,
    sshKey: sshKey || null,
    sshKeyPassphrase: sshKeyPassphrase || null,
    sessionId: sid,
    cols: cols ?? null,
    rows: rows ?? null,
  });
  return sid;
};

export const sshWrite = async (
  sessionId: string,
  data: string,
): Promise<void> => {
  return invoke<void>("ssh_write", { sessionId, data });
};

export const sshResize = async (
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> => {
  return invoke<void>("ssh_resize", { sessionId, cols, rows });
};

export const sshDisconnect = async (sessionId: string): Promise<void> => {
  return invoke<void>("ssh_disconnect", { sessionId });
};
