import { invoke } from "@tauri-apps/api/core";

/** Mouse event flags (bitmask) matching RDP protocol */
export const RDP_MOUSE = {
  MOVE: 0x0800,
  DOWN: 0x8000,
  LEFT_BUTTON: 0x1000,
  RIGHT_BUTTON: 0x2000,
  MIDDLE_BUTTON: 0x4000,
  VERTICAL_WHEEL: 0x0200,
  WHEEL_NEGATIVE: 0x0100,
} as const;

export const rdpConnect = async (
  serverId: string,
  password?: string | null,
  sessionId?: string,
  width?: number,
  height?: number,
  domain?: string | null,
): Promise<string> => {
  const sid = sessionId || crypto.randomUUID();
  await invoke<string>("rdp_connect", {
    serverId,
    password: password || null,
    sessionId: sid,
    width: width ?? 1280,
    height: height ?? 720,
    domain: domain || null,
  });
  return sid;
};

export const rdpDisconnect = async (sessionId: string): Promise<void> => {
  return invoke<void>("rdp_disconnect", { sessionId });
};

export const rdpSendMouse = async (
  sessionId: string,
  x: number,
  y: number,
  button: number,
  flags: number,
): Promise<void> => {
  return invoke<void>("rdp_send_mouse", { sessionId, x, y, button, flags });
};

export const rdpSendKey = async (
  sessionId: string,
  scancode: number,
  isDown: boolean,
  isExtended: boolean,
): Promise<void> => {
  return invoke<void>("rdp_send_key", { sessionId, scancode, isDown, isExtended });
};

export const rdpSendUnicode = async (
  sessionId: string,
  unicode: number,
  isDown: boolean,
): Promise<void> => {
  return invoke<void>("rdp_send_unicode", { sessionId, unicode, isDown });
};

export const rdpClipboardSet = async (
  sessionId: string,
  text: string,
): Promise<void> => {
  return invoke<void>("rdp_clipboard_set", { sessionId, text });
};

export const rdpResize = async (
  sessionId: string,
  width: number,
  height: number,
): Promise<void> => {
  return invoke<void>("rdp_resize", { sessionId, width, height });
};
