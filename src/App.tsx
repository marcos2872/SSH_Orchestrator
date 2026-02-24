import React, { useState, useEffect, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar';
import WorkspaceDetail from './components/Workspaces/WorkspaceDetail';
import TerminalWorkspace from './components/Terminal/TerminalWorkspace';
import ServerPickerModal from './components/Terminal/ServerPickerModal';
import SftpPanel from './components/Sftp/SftpPanel';
import { ToastProvider } from './hooks/useToast';
import ToastContainer from './components/Toast';
import TitleBar from './components/TitleBar';
import VaultGuard from './components/VaultGuard';
import { useTerminalManager } from './hooks/useTerminalManager';
import { useTerminalTheme } from './hooks/useTerminalTheme';
import { matchesBinding, KEYBINDINGS } from './lib/keybindings';
import type { Server } from './hooks/useTerminalManager';
import type { Server as ApiServer } from './lib/api/servers';

interface Workspace {
  id: string;
  name: string;
  color: string;
  sync_enabled?: boolean;
}

const App: React.FC = () => {
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null);
  const [showSftp, setShowSftp] = useState(false);
  const sftpRef = useRef(showSftp);
  sftpRef.current = showSftp;

  // Modal to pick a server when opening a new tab
  const [showServerPicker, setShowServerPicker] = useState(false);

  const {
    tabs, activeTabId, splitTab, splitMode,
    openTab, closeTab, splitPane, closeSplit, closeAll, setActiveTabId,
    activeTab, hasTabs,
  } = useTerminalManager();

  const { themeId, currentTheme, themes, changeTheme } = useTerminalTheme();
  const [showThemePicker, setShowThemePicker] = useState(false);

  const handleSelectWorkspace = (ws: Workspace | null) => {
    setSelectedWorkspace(ws);
  };

  const handleConnect = useCallback((server: Server) => {
    openTab(server);
  }, [openTab]);

  // Called when user picks a server from the modal
  const handlePickServer = (srv: ApiServer) => {
    openTab(srv as Server);
    setShowServerPicker(false);
  };

  // ── Keyboard shortcuts (silent — no UI hints) ─────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (matchesBinding(e, KEYBINDINGS.CLOSE_TAB)) {
        e.preventDefault();
        if (activeTabId) closeTab(activeTabId);
        return;
      }
      if (matchesBinding(e, KEYBINDINGS.NEXT_TAB)) {
        e.preventDefault();
        const mainTabs = tabs.filter(t => t.id !== splitTab?.id);
        if (mainTabs.length < 2) return;
        const idx = mainTabs.findIndex(t => t.id === activeTabId);
        setActiveTabId(mainTabs[(idx + 1) % mainTabs.length].id);
        return;
      }
      if (matchesBinding(e, KEYBINDINGS.PREV_TAB)) {
        e.preventDefault();
        const mainTabs = tabs.filter(t => t.id !== splitTab?.id);
        if (mainTabs.length < 2) return;
        const idx = mainTabs.findIndex(t => t.id === activeTabId);
        setActiveTabId(mainTabs[(idx - 1 + mainTabs.length) % mainTabs.length].id);
        return;
      }
      if (matchesBinding(e, KEYBINDINGS.SPLIT_V)) {
        e.preventDefault();
        if (activeTab && !splitTab) splitPane('vertical', activeTab.server);
        return;
      }
      if (matchesBinding(e, KEYBINDINGS.SPLIT_H)) {
        e.preventDefault();
        if (activeTab && !splitTab) splitPane('horizontal', activeTab.server);
        return;
      }
      if (matchesBinding(e, KEYBINDINGS.TOGGLE_SFTP)) {
        e.preventDefault();
        setShowSftp(v => !v);
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeTabId, activeTab, tabs, splitTab, closeTab, setActiveTabId, splitPane]);

  return (
    <ToastProvider>
      <VaultGuard>
        <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
          <TitleBar currentWorkspace={selectedWorkspace} />
          <div className="flex flex-1 overflow-hidden relative">
            <Sidebar
              onSelectWorkspace={handleSelectWorkspace}
              selectedId={selectedWorkspace?.id}
            />
            <main className="flex-1 flex overflow-hidden relative">
              {/* ── Main content area ── */}
              {!hasTabs ? (
                <div className="flex-1 flex flex-col overflow-hidden">
                  {selectedWorkspace ? (
                    <WorkspaceDetail
                      workspace={selectedWorkspace}
                      onConnect={handleConnect}
                      onWorkspaceUpdated={setSelectedWorkspace}
                      onWorkspaceDeleted={() => { setSelectedWorkspace(null); }}
                    />
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-slate-500">
                      <div className="text-center">
                        <div className="w-24 h-24 mx-auto mb-8 bg-slate-800/50 rounded-full flex items-center justify-center border border-slate-700">
                          <img src="/tauri.svg" className="w-12 h-12 opacity-40" alt="Tauri logo" />
                        </div>
                        <h2 className="text-xl font-light tracking-widest text-slate-400 mb-2">ORCHESTRATOR READY</h2>
                        <p className="text-sm font-light tracking-wide text-slate-600">Selecione um Workspace para gerenciar seus servidores</p>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* Terminal workspace (flex-1, fills remaining width) */}
                  <div className="flex flex-col flex-1 overflow-hidden min-w-0">
                    {/* Toolbar: nova aba | sftp | tema | fechar tudo */}
                    <div className="flex items-center justify-between px-2 h-7 bg-slate-950 border-b border-slate-800 shrink-0">
                      {/* Left: Nova aba + SFTP */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setShowServerPicker(true)}
                          title="Nova aba"
                          className="flex items-center gap-1 text-xs text-slate-400 hover:text-white px-2 py-0.5 rounded hover:bg-slate-800 transition-colors"
                        >
                          <span className="text-base leading-none">＋</span>
                          <span>Nova aba</span>
                        </button>
                        <button
                          onClick={() => setShowSftp(v => !v)}
                          title="Painel SFTP"
                          className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded transition-colors ${showSftp
                            ? 'bg-sky-600 text-white'
                            : 'text-slate-400 hover:text-white hover:bg-slate-800'
                            }`}
                        >
                          <span>📁</span>
                          <span>SFTP</span>
                        </button>
                      </div>

                      {/* Right: Tema + fechar tudo */}
                      <div className="flex items-center gap-2">
                        <div className="relative">
                          <button
                            onClick={() => setShowThemePicker(v => !v)}
                            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-white px-2 py-0.5 rounded hover:bg-slate-800 transition-colors"
                            title="Tema do terminal"
                          >
                            <span
                              className="w-2.5 h-2.5 rounded-full border border-slate-600"
                              style={{ background: currentTheme.theme.background as string }}
                            />
                            {currentTheme.name}
                          </button>
                          {showThemePicker && (
                            <div className="absolute right-0 top-full mt-1 z-50 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-2 w-44">
                              {themes.map(t => (
                                <button
                                  key={t.id}
                                  onClick={() => { changeTheme(t.id); setShowThemePicker(false); }}
                                  className={`
                                    w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs transition-colors
                                    ${t.id === themeId ? 'bg-sky-600 text-white' : 'text-slate-300 hover:bg-slate-800'}
                                  `}
                                >
                                  <span className="w-3 h-3 rounded-full border border-slate-600 shrink-0"
                                    style={{ background: t.theme.background as string }} />
                                  {t.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={closeAll}
                          className="text-xs text-slate-600 hover:text-red-400 px-2 py-0.5 rounded hover:bg-slate-800 transition-colors"
                          title="Fechar tudo"
                        >✕ tudo</button>
                      </div>
                    </div>

                    <TerminalWorkspace
                      tabs={tabs}
                      activeTabId={activeTabId}
                      splitTab={splitTab}
                      splitMode={splitMode}
                      themeId={themeId}
                      onSelectTab={setActiveTabId}
                      onCloseTab={closeTab}
                      onCloseSplit={closeSplit}
                    />
                  </div>

                  {/* SFTP side panel */}
                  {showSftp && (
                    <div className="w-72 shrink-0 overflow-hidden">
                      <SftpPanel
                        serverId={activeTab?.server.id ?? ''}
                        sessionId={activeTabId}
                        onClose={() => setShowSftp(false)}
                      />
                    </div>
                  )}
                </>
              )}
            </main>
          </div>
        </div>
        <ToastContainer />

        {/* Server picker modal — controlled via isOpen para manter animações do Modal.tsx */}
        <ServerPickerModal
          isOpen={showServerPicker}
          workspaceId={selectedWorkspace?.id ?? null}
          onSelect={handlePickServer}
          onClose={() => setShowServerPicker(false)}
        />
      </VaultGuard>
    </ToastProvider>
  );
};

export default App;
