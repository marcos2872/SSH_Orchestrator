import { useEffect, useRef, useCallback, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  rdpConnect,
  rdpDisconnect,
  rdpSendMouse,
  rdpSendKey,
  rdpClipboardSet,
  rdpResize,
  RDP_MOUSE,
} from "../../lib/api/rdp";
import { useToast } from "../../hooks/useToast";
import type { Server } from "../../hooks/useTerminalManager";

// Mapa de event.code do browser → RDP scancode (Set 1)
const CODE_TO_SCANCODE: Record<string, [number, boolean]> = {
  Escape: [0x01, false], Digit1: [0x02, false], Digit2: [0x03, false],
  Digit3: [0x04, false], Digit4: [0x05, false], Digit5: [0x06, false],
  Digit6: [0x07, false], Digit7: [0x08, false], Digit8: [0x09, false],
  Digit9: [0x0A, false], Digit0: [0x0B, false], Minus: [0x0C, false],
  Equal: [0x0D, false], Backspace: [0x0E, false], Tab: [0x0F, false],
  KeyQ: [0x10, false], KeyW: [0x11, false], KeyE: [0x12, false],
  KeyR: [0x13, false], KeyT: [0x14, false], KeyY: [0x15, false],
  KeyU: [0x16, false], KeyI: [0x17, false], KeyO: [0x18, false],
  KeyP: [0x19, false], BracketLeft: [0x1A, false], BracketRight: [0x1B, false],
  Enter: [0x1C, false], ControlLeft: [0x1D, false], KeyA: [0x1E, false],
  KeyS: [0x1F, false], KeyD: [0x20, false], KeyF: [0x21, false],
  KeyG: [0x22, false], KeyH: [0x23, false], KeyJ: [0x24, false],
  KeyK: [0x25, false], KeyL: [0x26, false], Semicolon: [0x27, false],
  Quote: [0x28, false], Backquote: [0x29, false], ShiftLeft: [0x2A, false],
  Backslash: [0x2B, false], KeyZ: [0x2C, false], KeyX: [0x2D, false],
  KeyC: [0x2E, false], KeyV: [0x2F, false], KeyB: [0x30, false],
  KeyN: [0x31, false], KeyM: [0x32, false], Comma: [0x33, false],
  Period: [0x34, false], Slash: [0x35, false], ShiftRight: [0x36, false],
  NumpadMultiply: [0x37, false], AltLeft: [0x38, false], Space: [0x39, false],
  CapsLock: [0x3A, false], F1: [0x3B, false], F2: [0x3C, false],
  F3: [0x3D, false], F4: [0x3E, false], F5: [0x3F, false],
  F6: [0x40, false], F7: [0x41, false], F8: [0x42, false],
  F9: [0x43, false], F10: [0x44, false], NumLock: [0x45, false],
  ScrollLock: [0x46, false], F11: [0x57, false], F12: [0x58, false],
  // Extended keys
  ControlRight: [0x1D, true], AltRight: [0x38, true],
  ArrowUp: [0x48, true], ArrowDown: [0x50, true],
  ArrowLeft: [0x4B, true], ArrowRight: [0x4D, true],
  Home: [0x47, true], End: [0x4F, true],
  PageUp: [0x49, true], PageDown: [0x51, true],
  Insert: [0x52, true], Delete: [0x53, true],
  MetaLeft: [0x5B, true], MetaRight: [0x5C, true],
  ContextMenu: [0x5D, true], NumpadEnter: [0x1C, true],
  NumpadDivide: [0x35, true], PrintScreen: [0x37, true],
  Pause: [0x45, true],
};

interface Props {
  server: Server;
  tabId: string;
  onSessionReady?: (sessionId: string) => void;
}

interface RdpFrameEvent {
  x: number;
  y: number;
  w: number;
  h: number;
  format: string;
  data: string;
}

interface RdpResolutionEvent {
  width: number;
  height: number;
}

export default function RdpViewer({ server, tabId, onSessionReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("Conectando...");
  const [resolution, setResolution] = useState({ width: 1280, height: 720 });
  const { error: toastError } = useToast();

  // Conectar ao servidor RDP
  useEffect(() => {
    let cancelled = false;
    const unlisteners: (() => void)[] = [];

    const connect = async () => {
      const sid = crypto.randomUUID();
      sessionIdRef.current = sid;

      try {
        // Setup event listeners BEFORE connecting
        const unFrame = await listen<RdpFrameEvent>(`rdp://frame/${sid}`, (event) => {
          renderFrame(event.payload);
        });
        unlisteners.push(unFrame);

        const unResolution = await listen<RdpResolutionEvent>(`rdp://resolution/${sid}`, (event) => {
          setResolution({ width: event.payload.width, height: event.payload.height });
        });
        unlisteners.push(unResolution);

        const unClose = await listen<string>(`rdp://close/${sid}`, (event) => {
          setConnected(false);
          setStatus(event.payload || "Desconectado");
        });
        unlisteners.push(unClose);

        // Determine initial size from container
        const container = containerRef.current;
        const w = container ? Math.max(800, container.clientWidth) : 1280;
        const h = container ? Math.max(600, container.clientHeight) : 720;

        if (cancelled) return;

        await rdpConnect(server.id, null, sid, w, h);
        if (!cancelled) {
          setConnected(true);
          setStatus("Conectado");
          onSessionReady?.(sid);
        }
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          setStatus(`Falha: ${msg}`);
          toastError(msg);
        }
      }
    };

    connect();

    return () => {
      cancelled = true;
      unlisteners.forEach((u) => u());
      if (sessionIdRef.current) {
        rdpDisconnect(sessionIdRef.current).catch(() => {});
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id, tabId]);

  // Resize dinâmico: quando o container muda de tamanho, solicita nova resolução ao servidor
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || !sessionIdRef.current) return;

      const newW = Math.max(800, Math.floor(entry.contentRect.width));
      const newH = Math.max(600, Math.floor(entry.contentRect.height));

      // Só redimensionar se mudou significativamente (evita loops)
      if (Math.abs(newW - resolution.width) < 16 && Math.abs(newH - resolution.height) < 16) return;

      // Debounce de 500ms para não bombardear o servidor durante drag
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (sessionIdRef.current) {
          rdpResize(sessionIdRef.current, newW, newH).catch(() => {});
        }
      }, 500);
    });

    observer.observe(container);
    return () => {
      observer.disconnect();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [resolution.width, resolution.height]);

  // Renderizar dirty rect no canvas — otimizado para raw RGBA (putImageData direto)
  const renderFrame = useCallback((frame: RdpFrameEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const expectedLen = frame.w * frame.h * 4;

    if (frame.format === "jpeg") {
      // JPEG path (fallback, não mais usado no pipeline principal)
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, frame.x, frame.y);
      };
      img.src = `data:image/jpeg;base64,${frame.data}`;
    } else {
      // Raw RGBA — decode base64 via fetch (mais rápido que atob + loop)
      // Usa binary string decode nativo do browser que é muito mais eficiente
      const binaryStr = atob(frame.data);
      const len = binaryStr.length;
      if (len !== expectedLen) return;

      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      const imgData = new ImageData(new Uint8ClampedArray(bytes.buffer), frame.w, frame.h);
      ctx.putImageData(imgData, frame.x, frame.y);
    }
  }, []);

  // Mouse events
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!sessionIdRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = resolution.width / rect.width;
    const scaleY = resolution.height / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);
    rdpSendMouse(sessionIdRef.current, x, y, 0, RDP_MOUSE.MOVE).catch(() => {});
  }, [resolution]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!sessionIdRef.current || !canvasRef.current) return;
    e.preventDefault();
    // preventDefault no mousedown impede o foco automático; focamos manualmente
    // para que os eventos de teclado (onKeyDown/onKeyUp) passem a disparar.
    canvasRef.current.focus();
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = resolution.width / rect.width;
    const scaleY = resolution.height / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);
    const button = e.button === 0 ? 1 : e.button === 2 ? 2 : 3;
    rdpSendMouse(sessionIdRef.current, x, y, button, RDP_MOUSE.DOWN).catch(() => {});
  }, [resolution]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!sessionIdRef.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = resolution.width / rect.width;
    const scaleY = resolution.height / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);
    const button = e.button === 0 ? 1 : e.button === 2 ? 2 : 3;
    rdpSendMouse(sessionIdRef.current, x, y, button, 0).catch(() => {});
  }, [resolution]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!sessionIdRef.current || !canvasRef.current) return;
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = resolution.width / rect.width;
    const scaleY = resolution.height / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);
    const flags = RDP_MOUSE.VERTICAL_WHEEL | (e.deltaY > 0 ? RDP_MOUSE.WHEEL_NEGATIVE : 0);
    rdpSendMouse(sessionIdRef.current, x, y, 0, flags).catch(() => {});
  }, [resolution]);

  // Keyboard events
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!sessionIdRef.current) return;
    e.preventDefault();
    e.stopPropagation();

    // Handle Ctrl+V (paste from local clipboard)
    if (e.ctrlKey && e.code === "KeyV") {
      navigator.clipboard.readText().then((text) => {
        if (text && sessionIdRef.current) {
          rdpClipboardSet(sessionIdRef.current, text).catch(() => {});
        }
      }).catch(() => {});
    }

    const mapping = CODE_TO_SCANCODE[e.code];
    if (mapping) {
      const [scancode, isExtended] = mapping;
      rdpSendKey(sessionIdRef.current, scancode, true, isExtended).catch(() => {});
    }
  }, []);

  const handleKeyUp = useCallback((e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!sessionIdRef.current) return;
    e.preventDefault();
    e.stopPropagation();

    const mapping = CODE_TO_SCANCODE[e.code];
    if (mapping) {
      const [scancode, isExtended] = mapping;
      rdpSendKey(sessionIdRef.current, scancode, false, isExtended).catch(() => {});
    }
  }, []);

  // Context menu (right-click) — prevent default
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative flex items-center justify-center w-full h-full bg-black overflow-hidden"
      onContextMenu={handleContextMenu}
    >
      {!connected && (
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-black/80">
          <span className="text-zinc-400 text-sm">{status}</span>
        </div>
      )}
      <canvas
        ref={canvasRef}
        width={resolution.width}
        height={resolution.height}
        tabIndex={0}
        className="w-full h-full object-contain outline-none cursor-default"
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onContextMenu={handleContextMenu}
        style={{ imageRendering: "auto" }}
      />
    </div>
  );
}
