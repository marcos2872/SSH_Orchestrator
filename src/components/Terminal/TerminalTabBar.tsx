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
      className="flex items-stretch overflow-x-auto scrollbar-none bg-slate-950 border-b border-slate-800 shrink-0"
      style={{ height: "36px" }}
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

        const dotColor = isActive
          ? isLocal
            ? "bg-emerald-400"
            : "bg-green-400"
          : "bg-slate-600";

        return (
          <button
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            className={`
              group flex items-center gap-2 px-3 h-full text-xs font-mono shrink-0
              border-r border-slate-800 border-t-2 transition-colors select-none
              ${
                isActive
                  ? `bg-[#0f172a] text-slate-100 ${isLocal ? "border-t-emerald-500" : "border-t-sky-500"}`
                  : "bg-slate-950 text-slate-400 hover:bg-slate-900 hover:text-slate-200 border-t-transparent"
              }
            `}
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
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
              className="ml-1 w-4 h-4 flex items-center justify-center rounded hover:bg-slate-700 opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-white"
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
