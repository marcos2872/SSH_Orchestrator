import { invoke } from "@tauri-apps/api/core";

export const ptySpawn = async (
  sessionId: string,
  cols?: number,
  rows?: number,
  shell?: string,
): Promise<string> => {
  return invoke<string>("pty_spawn", {
    sessionId,
    cols: cols ?? null,
    rows: rows ?? null,
    shell: shell ?? null,
  });
};

export const ptyWrite = async (
  sessionId: string,
  data: string,
): Promise<void> => {
  return invoke<void>("pty_write", { sessionId, data });
};

export const ptyResize = async (
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> => {
  return invoke<void>("pty_resize", { sessionId, cols, rows });
};

export const ptyKill = async (sessionId: string): Promise<void> => {
  return invoke<void>("pty_kill", { sessionId });
};
