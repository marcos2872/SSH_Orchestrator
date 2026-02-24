import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Monitor, Plus, Settings, Shield, Terminal as TerminalIcon, HardDrive } from 'lucide-react';

interface Server {
    id: string;
    name: string;
    host: string;
    username: string;
}

interface Props {
    workspace: { id: string; name: string };
    onConnect: (serverId: string) => void;
}

const WorkspaceDetail: React.FC<Props> = ({ workspace, onConnect }) => {
    const [servers, setServers] = useState<Server[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadServers();
    }, [workspace.id]);

    const loadServers = async () => {
        setLoading(true);
        try {
            const res = await invoke<Server[]>('get_servers', { workspaceId: workspace.id });
            setServers(res);
        } catch (err) {
            console.error('Failed to load servers:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateServer = async () => {
        try {
            await invoke('create_server', {
                workspaceId: workspace.id,
                name: `Server ${servers.length + 1}`,
                host: '127.0.0.1',
                port: 22,
                username: 'root'
            });
            loadServers();
        } catch (err) {
            console.error('Failed to create server:', err);
        }
    };

    return (
        <div className="flex-1 flex flex-col">
            <header className="h-16 border-b border-slate-800 flex items-center justify-between px-8 bg-slate-900/50 backdrop-blur-sm">
                <div className="flex items-center gap-4">
                    <div className="p-2 bg-primary/10 rounded-lg">
                        <Monitor className="text-primary w-5 h-5" />
                    </div>
                    <div>
                        <h2 className="text-lg font-semibold">{workspace.name}</h2>
                        <p className="text-xs text-slate-500">{servers.length} servidores ativos</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleCreateServer}
                        className="flex items-center gap-2 bg-primary hover:bg-blue-600 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        Adicionar Servidor
                    </button>
                    <button className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400">
                        <Settings className="w-5 h-5" />
                    </button>
                </div>
            </header>

            <div className="flex-1 overflow-y-auto p-8">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {servers.map((server) => (
                        <div
                            key={server.id}
                            className="bg-secondary/40 border border-slate-800 p-5 rounded-xl hover:border-primary/50 transition-all group cursor-pointer"
                        >
                            <div className="flex items-start justify-between mb-4">
                                <div className="p-2 bg-slate-800 rounded-lg group-hover:bg-primary/20 transition-colors">
                                    <TerminalIcon className="w-5 h-5 text-slate-400 group-hover:text-primary" />
                                </div>
                                <div className="flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">Ativo</span>
                                </div>
                            </div>
                            <h3 className="font-semibold mb-1">{server.name}</h3>
                            <p className="text-xs text-slate-400 font-mono mb-4">{server.username}@{server.host}</p>

                            <div className="flex items-center gap-2 pt-4 border-t border-slate-800 mt-auto">
                                <button
                                    onClick={() => onConnect(server.id)}
                                    className="flex-1 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 rounded-md transition-colors flex items-center justify-center gap-2"
                                >
                                    <TerminalIcon className="w-3 h-3" /> Connect
                                </button>
                                <button className="px-3 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 rounded-md transition-colors">
                                    <HardDrive className="w-3 h-3" />
                                </button>
                            </div>
                        </div>
                    ))}

                    {!loading && servers.length === 0 && (
                        <div className="col-span-full py-20 text-center border-2 border-dashed border-slate-800 rounded-2xl">
                            <Shield className="w-12 h-12 text-slate-700 mx-auto mb-4" />
                            <h3 className="text-slate-400 font-medium">Nenhum servidor neste workspace</h3>
                            <p className="text-sm text-slate-600 mb-6">Comece adicionando um novo host para gerenciar.</p>
                            <button
                                onClick={handleCreateServer}
                                className="text-primary text-sm font-semibold hover:underline"
                            >
                                Criar primeiro servidor
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default WorkspaceDetail;
