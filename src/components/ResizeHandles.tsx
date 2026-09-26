import React, { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

// Direções aceitas por Window.startResizeDragging (Tauri v2)
type ResizeDirection =
  | "East"
  | "North"
  | "NorthEast"
  | "NorthWest"
  | "South"
  | "SouthEast"
  | "SouthWest"
  | "West";

interface HandleDef {
  direction: ResizeDirection;
  cursor: string;
  style: React.CSSProperties;
}

const EDGE = 6;
const CORNER = 14;
const Z_INDEX = 8000;

const baseStyle: React.CSSProperties = {
  position: "fixed",
  zIndex: Z_INDEX,
  background: "transparent",
  touchAction: "none",
};

// Faixas nas bordas + quadrados nas quinas para facilitar o acerto do mouse
const HANDLES: HandleDef[] = [
  {
    direction: "North",
    cursor: "ns-resize",
    style: {
      ...baseStyle,
      top: 0,
      left: CORNER,
      right: CORNER,
      height: EDGE,
      cursor: "ns-resize",
    },
  },
  {
    direction: "South",
    cursor: "ns-resize",
    style: {
      ...baseStyle,
      bottom: 0,
      left: CORNER,
      right: CORNER,
      height: EDGE,
      cursor: "ns-resize",
    },
  },
  {
    direction: "West",
    cursor: "ew-resize",
    style: {
      ...baseStyle,
      left: 0,
      top: CORNER,
      bottom: CORNER,
      width: EDGE,
      cursor: "ew-resize",
    },
  },
  {
    direction: "East",
    cursor: "ew-resize",
    style: {
      ...baseStyle,
      right: 0,
      top: CORNER,
      bottom: CORNER,
      width: EDGE,
      cursor: "ew-resize",
    },
  },
  {
    direction: "NorthWest",
    cursor: "nwse-resize",
    style: {
      ...baseStyle,
      top: 0,
      left: 0,
      width: CORNER,
      height: CORNER,
      cursor: "nwse-resize",
    },
  },
  {
    direction: "NorthEast",
    cursor: "nesw-resize",
    style: {
      ...baseStyle,
      top: 0,
      right: 0,
      width: CORNER,
      height: CORNER,
      cursor: "nesw-resize",
    },
  },
  {
    direction: "SouthWest",
    cursor: "nesw-resize",
    style: {
      ...baseStyle,
      bottom: 0,
      left: 0,
      width: CORNER,
      height: CORNER,
      cursor: "nesw-resize",
    },
  },
  {
    direction: "SouthEast",
    cursor: "nwse-resize",
    style: {
      ...baseStyle,
      bottom: 0,
      right: 0,
      width: CORNER,
      height: CORNER,
      cursor: "nwse-resize",
    },
  },
];

interface Props {}

const ResizeHandles: React.FC<Props> = () => {
  const [isMaximized, setIsMaximized] = useState(false);

  // Esconde as alças com a janela maximizada (resize não se aplica)
  useEffect(() => {
    appWindow.isMaximized().then(setIsMaximized);
    const unlisten = appWindow.onResized(async () => {
      setIsMaximized(await appWindow.isMaximized());
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  if (isMaximized) return null;

  return (
    <>
      {HANDLES.map((handle) => (
        <div
          key={handle.direction}
          style={handle.style}
          onMouseDown={(e) => {
            e.preventDefault();
            appWindow.startResizeDragging(handle.direction).catch(() => {});
          }}
        />
      ))}
    </>
  );
};

export default ResizeHandles;
