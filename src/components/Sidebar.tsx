import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Layout, Plus, Server, Folder, ChevronRight, Activity } from 'lucide-react';

interface Workspace {
    id: string;
    name: string;
    color: string;
}

interface Props {
    onSelectWorkspace: (ws: Workspace) => void;
    selectedId?: string;
}

const Sidebar: React.FC<Props> = ({ onSelectWorkspace, selectedId }) => {
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

    useEffect(() => {
        loadWorkspaces();
    }, []);

    const loadWorkspaces = async () => {
        try {
            const res = await invoke<Workspace[]>('get_workspaces');
            setWorkspaces(res);
        } catch (err) {
            console.error('Failed to load workspaces:', err);
        }
    };

    const handleCreateWorkspace = async () => {
        try {
            await invoke('create_workspace', { name: 'Novo Workspace', color: '#3b82f6' });
            loadWorkspaces();
        } catch (err) {
            console.error('Failed to create workspace:', err);
        }
    };

    return (
        <div className="w-64 bg-secondary h-screen border-r border-slate-700 flex flex-col p-4">
            <div className="flex items-center justify-between mb-8">
                <h1 className="text-xl font-bold flex items-center gap-2">
                    <Activity className="text-primary w-6 h-6" />
                    SSH Config
                </h1>
                <button
                    onClick={handleCreateWorkspace}
                    className="p-1 hover:bg-slate-700 rounded-md transition-colors"
                >
                    <Plus className="w-5 h-5 text-slate-400" />
                </button>
            </div>

            <nav className="flex-1 overflow-y-auto space-y-2">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4 px-2">
                    Workspaces
                </div>
                {workspaces.map((ws) => (
                    <div
                        key={ws.id}
                        onClick={() => onSelectWorkspace(ws)}
                        className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer group transition-all ${selectedId === ws.id ? 'bg-primary/20 text-white' : 'hover:bg-slate-800'
                            }`}
                    >
                        <div
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: ws.color }}
                        />
                        <span className="flex-1 text-sm font-medium">{ws.name}</span>
                        <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-slate-400" />
                    </div>
                ))}

                {workspaces.length === 0 && (
                    <div className="px-3 py-8 text-center">
                        <Folder className="w-8 h-8 text-slate-600 mx-auto mb-2 opacity-50" />
                        <p className="text-xs text-slate-500">Nenhum workspace encontrado</p>
                    </div>
                )}
            </nav>

            <div className="pt-4 border-t border-slate-700 mt-auto">
                <div className="flex items-center gap-3 px-3 py-2 text-slate-400 hover:text-white cursor-pointer rounded-lg hover:bg-slate-800 transition-colors">
                    <Server className="w-5 h-5" />
                    <span className="text-sm">Configuração</span>
                </div>
            </div>
        </div>
    );
};

export default Sidebar;
