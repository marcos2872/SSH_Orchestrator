import React, { useRef, useCallback } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import Terminal, { type TerminalRef } from "./Terminal";
import LocalTerminal, { type LocalTerminalRef } from "./LocalTerminal";
import TerminalTabBar from "./TerminalTabBar";
import SftpDualPane from "../Sftp/SftpDualPane";
import type { Tab, SplitMode } from "../../hooks/useTerminalManager";

interface Props {
  tabs: Tab[];
  activeTabId: string | null;
  splitTab: Tab | null;
  splitMode: SplitMode;
  themeId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onSessionId: (tabId: string, sshSessionId: string) => void;
}

const TerminalWorkspace: React.FC<Props> = ({
  tabs,
  activeTabId,
  splitTab,
  splitMode,
  themeId,
  onSelectTab,
  onCloseTab,
  onSessionId,
}) => {
  const mainTermRef = useRef<TerminalRef>(null);
  const mainLocalRef = useRef<LocalTerminalRef>(null);
  const splitTermRef = useRef<TerminalRef>(null);
  const splitLocalRef = useRef<LocalTerminalRef>(null);

  const handleLayout = useCallback(() => {
    setTimeout(() => {
      mainTermRef.current?.fit();
      mainLocalRef.current?.fit();
      splitTermRef.current?.fit();
      splitLocalRef.current?.fit();
    }, 50);
  }, []);

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  if (!activeTab) return null;

  const orientation = splitMode === "horizontal" ? "horizontal" : "vertical";
  const mainTabs = tabs.filter((t) => t.id !== splitTab?.id);

  // ── Render a single tab's content ─────────────────────────────────────────
  const renderTabContent = (
    tab: Tab,
    isActive: boolean,
    termRef: React.RefObject<TerminalRef | null>,
    localRef: React.RefObject<LocalTerminalRef | null>,
  ) => {
    if (tab.type === "local") {
      return (
        <LocalTerminal
          ref={isActive ? localRef : undefined}
          onClose={() => onCloseTab(tab.id)}
          themeId={themeId}
          isActive={isActive}
        />
      );
    }

    if (tab.type === "sftp") {
      return (
        <div className="flex-1 overflow-hidden">
          {tab.server && <SftpDualPane server={tab.server} />}
        </div>
      );
    }

    // type === 'terminal' (SSH)
    if (!tab.server) return null;
    return (
      <Terminal
        ref={isActive ? termRef : undefined}
        server={tab.server}
        onClose={() => onCloseTab(tab.id)}
        themeId={themeId}
        onSessionId={(sid) => onSessionId(tab.id, sid)}
        isActive={isActive}
      />
    );
  };

  // ── We must render ALL tabs inside the DOM and hide inactive ones
  // ── so that their SSH/PTY connections (which depend on component mount) are not dropped.

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      <TerminalTabBar
        tabs={mainTabs}
        activeTabId={activeTabId}
        onSelect={onSelectTab}
        onClose={onCloseTab}
      />

      <Group
        orientation={orientation}
        className="flex-1 overflow-hidden relative"
        onLayoutChange={handleLayout}
      >
        <Panel
          defaultSize={splitTab && splitMode !== "none" ? 50 : 100}
          minSize={20}
          className="relative"
          style={{ background: "#000000" }}
        >
          {mainTabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                className={`absolute inset-0 flex flex-col ${isActive ? "z-10 opacity-100 pointer-events-auto" : "z-0 opacity-0 pointer-events-none"}`}
              >
                {renderTabContent(tab, isActive, mainTermRef, mainLocalRef)}
              </div>
            );
          })}
        </Panel>

        {splitTab && splitMode !== "none" && (
          <>
          <Separator
            className={`
                            ${orientation === "horizontal" ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize"}
                            transition-colors shrink-0
                        `}
            style={{ background: "rgba(255,255,255,0.08)" }}
          />
          <Panel
            defaultSize={50}
            minSize={20}
            className="relative"
            style={{ background: "#000000" }}
          >
              <div className="absolute inset-0 flex flex-col z-10">
                {renderTabContent(splitTab, true, splitTermRef, splitLocalRef)}
              </div>
            </Panel>
          </>
        )}
      </Group>
    </div>
  );
};

export default TerminalWorkspace;
