import React from "react";
import type { Tab } from "../../hooks/useTerminalManager";

interface Props {
  tabs: Tab[];
  activeTabId: string | null;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
}

const TerminalTabBar: React.FC<Props> = ({
  tabs,
  activeTabId,
  onSelect,
  onClose,
}) => {
  return (
    <div
      className="flex items-stretch overflow-x-auto scrollbar-none shrink-0 border-b"
      style={{
        height: "36px",
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(20px) saturate(180%)",
        WebkitBackdropFilter: "blur(20px) saturate(180%)",
        borderColor: "rgba(255,255,255,0.08)",
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const isLocal = tab.type === "local";
        const isSftp = tab.type === "sftp";

        const icon = isLocal ? "⬛" : isSftp ? "📁" : "";
        const label = isLocal
          ? "Local Shell"
          : tab.server
            ? `${tab.server.username}@${tab.server.host}`
            : "Unknown";

        // Dot color: Apple green for local, Apple system blue for SSH/SFTP
        const dotColor = isActive
          ? isLocal
            ? "#32d74b"
            : isSftp
              ? "#64d2ff"
              : "#0a84ff"
          : "rgba(255,255,255,0.2)";

        return (
          <button
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            className="group flex items-center gap-2 px-3 h-full text-xs font-mono shrink-0 transition-colors select-none"
            style={{
              borderRight: "1px solid rgba(255,255,255,0.06)",
              borderBottom: isActive
                ? `2px solid ${isLocal ? "#32d74b" : isSftp ? "#64d2ff" : "#0a84ff"}`
                : "2px solid transparent",
              background: isActive
                ? "rgba(255,255,255,0.07)"
                : "transparent",
              color: isActive
                ? "rgba(255,255,255,0.9)"
                : "rgba(255,255,255,0.4)",
            }}
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: dotColor }}
            />
            {icon && (
              <span className="text-[10px] leading-none shrink-0">{icon}</span>
            )}
            <span className="max-w-[130px] truncate">{label}</span>
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab.id);
              }}
              className="ml-1 w-4 h-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity"
              style={{
                color: "rgba(255,255,255,0.5)",
              }}
              title="Fechar aba"
            >
              ✕
            </span>
          </button>
        );
      })}
    </div>
  );
};

export default TerminalTabBar;
