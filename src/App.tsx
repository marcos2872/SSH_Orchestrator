import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import WorkspaceDetail from './components/Workspaces/WorkspaceDetail';
import Terminal from './components/Terminal/Terminal';
import { ToastProvider } from './hooks/useToast';
import ToastContainer from './components/Toast';
import TitleBar from './components/TitleBar';
import VaultGuard from './components/VaultGuard';

interface Workspace {
  id: string;
  name: string;
  color: string;
  sync_enabled?: boolean;
}

interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  has_saved_password: boolean;
}

const App: React.FC = () => {
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null);
  const [activeServer, setActiveServer] = useState<Server | null>(null);

  const handleSelectWorkspace = (ws: Workspace | null) => {
    setSelectedWorkspace(ws);
    setActiveServer(null);
  };

  return (
    <ToastProvider>
      <VaultGuard>
        <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
          <TitleBar currentWorkspace={selectedWorkspace} />
          <div className="flex flex-1 overflow-hidden">
            <Sidebar
              onSelectWorkspace={handleSelectWorkspace}
              selectedId={selectedWorkspace?.id}
            />
            <main className="flex-1 flex flex-col relative overflow-hidden">
              {selectedWorkspace ? (
                <WorkspaceDetail
                  workspace={selectedWorkspace}
                  onConnect={setActiveServer}
                  onWorkspaceUpdated={(updated) => setSelectedWorkspace(updated)}
                  onWorkspaceDeleted={() => { setSelectedWorkspace(null); setActiveServer(null); }}
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

              {activeServer && (
                <Terminal
                  server={activeServer}
                  onClose={() => setActiveServer(null)}
                />
              )}
            </main>
          </div>
        </div>
        <ToastContainer />
      </VaultGuard>
    </ToastProvider>
  );
};

export default App;

