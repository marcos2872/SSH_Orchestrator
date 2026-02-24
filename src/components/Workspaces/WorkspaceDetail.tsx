import React, { useEffect, useState } from 'react';
import { updateWorkspace, deleteWorkspace } from '../../lib/api/workspaces';
import { Server, getServers, deleteServer } from '../../lib/api/servers';
import {
    Monitor, Plus, Settings, Shield, Terminal as TerminalIcon,
    HardDrive, X, Trash2, Save, Pencil, Lock
} from 'lucide-react';
import { useToast } from '../../hooks/useToast';
import AddServerModal from '../Servers/AddServerModal';

interface Props {
    workspace: { id: string; name: string; color: string };
    onConnect: (server: Server) => void;
    onWorkspaceUpdated: (ws: { id: string; name: string; color: string }) => void;
    onWorkspaceDeleted: () => void;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

const WorkspaceDetail: React.FC<Props> = ({ workspace, onConnect, onWorkspaceUpdated, onWorkspaceDeleted }) => {
    const toast = useToast();
    const [servers, setServers] = useState<Server[]>([]);
    const [loading, setLoading] = useState(true);
    const [showSettings, setShowSettings] = useState(false);

    // Modal state
    const [showAddModal, setShowAddModal] = useState(false);
    const [editingServer, setEditingServer] = useState<Server | null>(null);
    const [confirmDeleteServerId, setConfirmDeleteServerId] = useState<string | null>(null);

    // Workspace edit state
    const [wsName, setWsName] = useState(workspace.name);
    const [wsColor, setWsColor] = useState(workspace.color);
    const [wsSyncEnabled, setWsSyncEnabled] = useState((workspace as any).sync_enabled || false);
    const [savingWs, setSavingWs] = useState(false);
    const [confirmDeleteWs, setConfirmDeleteWs] = useState(false);

    useEffect(() => {
        loadServers();
    }, [workspace.id]);

    useEffect(() => {
        setWsName(workspace.name);
        setWsColor(workspace.color);
        setWsSyncEnabled((workspace as any).sync_enabled || false);
    }, [workspace]);

    const loadServers = async () => {
        setLoading(true);
        try {
            const res = await getServers(workspace.id);
            setServers(res);
        } catch (err) {
            toast.error(`Erro ao carregar servidores: ${err}`);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteServer = async (id: string) => {
        try {
            await deleteServer(id);
            setConfirmDeleteServerId(null);
            toast.success('Servidor excluído.');
            await loadServers();
        } catch (err) {
            toast.error(`Erro ao excluir servidor: ${err}`);
        }
    };

    const handleSaveWorkspace = async () => {
        setSavingWs(true);
        try {
            await updateWorkspace(workspace.id, wsName, wsColor, wsSyncEnabled);
            onWorkspaceUpdated({ id: workspace.id, name: wsName, color: wsColor, sync_enabled: wsSyncEnabled } as any);
            window.dispatchEvent(new Event('workspaces-updated'));
            toast.success('Workspace atualizado!');
            setShowSettings(false);
        } catch (err) {
            toast.error(`Erro ao atualizar workspace: ${err}`);
        } finally {
            setSavingWs(false);
        }
    };

    const handleDeleteWorkspace = async () => {
        try {
            await deleteWorkspace(workspace.id);
            toast.success('Workspace excluído.');
            window.dispatchEvent(new Event('workspaces-updated'));
            onWorkspaceDeleted();
        } catch (err) {
            toast.error(`Erro ao excluir workspace: ${err}`);
        }
    };

    return (
        <div className="flex-1 flex flex-col min-h-0">
            {/* Header */}
            <header className="h-16 border-b border-slate-800 flex items-center justify-between px-8 bg-slate-900/50 backdrop-blur-sm shrink-0">
                <div className="flex items-center gap-4">
                    <div className="p-2 bg-primary/10 rounded-lg">
                        <Monitor className="text-primary w-5 h-5" />
                    </div>
                    <div>
                        <h2 className="text-lg font-semibold">{workspace.name}</h2>
                        <p className="text-xs text-slate-500">{servers.length} servidor{servers.length !== 1 ? 'es' : ''}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowAddModal(true)}
                        className="flex items-center gap-2 bg-primary hover:bg-blue-600 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        Adicionar Servidor
                    </button>
                    <button
                        onClick={() => { setShowSettings(true); setConfirmDeleteWs(false); }}
                        title="Configurações do Workspace"
                        className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-white"
                    >
                        <Settings className="w-5 h-5" />
                    </button>
                </div>
            </header>

            {/* Server grid */}
            <div className="flex-1 overflow-y-auto p-8">
                {loading ? (
                    <div className="flex items-center justify-center py-20 text-slate-500 text-sm">
                        Carregando servidores...
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {servers.map((server) => (
                            <div key={server.id} className="bg-secondary/40 border border-slate-800 p-5 rounded-xl hover:border-primary/50 transition-all group">
                                <div className="flex items-start justify-between mb-3">
                                    <div className="p-2 bg-slate-800 rounded-lg group-hover:bg-primary/20 transition-colors">
                                        <TerminalIcon className="w-5 h-5 text-slate-400 group-hover:text-primary" />
                                    </div>
                                    <div className="flex items-center gap-1">
                                        {server.has_saved_password && (
                                            <span title="Senha salva" className="p-1 text-green-500/70">
                                                <Lock className="w-3 h-3" />
                                            </span>
                                        )}
                                        <button
                                            onClick={() => setEditingServer(server)}
                                            title="Editar servidor"
                                            className="p-1 opacity-0 group-hover:opacity-100 hover:bg-slate-700 rounded transition-all text-slate-400 hover:text-white"
                                        >
                                            <Pencil className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                            onClick={() => setConfirmDeleteServerId(server.id)}
                                            title="Excluir servidor"
                                            className="p-1 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 rounded transition-all text-slate-400 hover:text-red-400"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                                <h3 className="font-semibold mb-1 truncate">{server.name}</h3>
                                <p className="text-xs text-slate-400 font-mono mb-4 truncate">
                                    {server.username}@{server.host}:{server.port}
                                </p>
                                <div className="flex items-center gap-2 pt-4 border-t border-slate-800">
                                    <button
                                        onClick={() => onConnect(server)}
                                        className="flex-1 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 rounded-md transition-colors flex items-center justify-center gap-2"
                                    >
                                        <TerminalIcon className="w-3 h-3" /> Connect
                                    </button>
                                    <button
                                        onClick={() => toast.info('SFTP estará disponível na Phase 0.4 🚀')}
                                        title="SFTP (Phase 0.4)"
                                        className="px-3 py-2 text-xs font-semibold bg-slate-800 hover:bg-slate-700 rounded-md transition-colors"
                                    >
                                        <HardDrive className="w-3 h-3" />
                                    </button>
                                </div>
                            </div>
                        ))}

                        {servers.length === 0 && (
                            <div className="col-span-full py-20 text-center border-2 border-dashed border-slate-800 rounded-2xl">
                                <Shield className="w-12 h-12 text-slate-700 mx-auto mb-4" />
                                <h3 className="text-slate-400 font-medium">Nenhum servidor neste workspace</h3>
                                <p className="text-sm text-slate-600 mb-6">Comece adicionando um novo host.</p>
                                <button
                                    onClick={() => setShowAddModal(true)}
                                    className="text-primary text-sm font-semibold hover:underline"
                                >
                                    Criar primeiro servidor
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* ── Add / Edit Server Modal ── */}
            {(showAddModal || editingServer) && (
                <AddServerModal
                    workspaceId={workspace.id}
                    server={editingServer}
                    onClose={() => { setShowAddModal(false); setEditingServer(null); }}
                    onSaved={() => { setShowAddModal(false); setEditingServer(null); loadServers(); }}
                />
            )}

            {/* ── Workspace Settings Modal ── */}
            {showSettings && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 w-[420px] shadow-2xl">
                        <div className="flex items-center justify-between mb-6">
                            <h2 className="text-lg font-semibold">Configurações do Workspace</h2>
                            <button onClick={() => setShowSettings(false)} className="text-slate-500 hover:text-white"><X className="w-5 h-5" /></button>
                        </div>
                        {!confirmDeleteWs ? (
                            <>
                                <div className="space-y-4 mb-6">
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-1">Nome do Workspace</label>
                                        <input
                                            value={wsName}
                                            onChange={e => setWsName(e.target.value)}
                                            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                        />
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <label className="block text-xs text-slate-500">Sincronizar no GitHub (Smart Sync)</label>
                                        <button
                                            type="button"
                                            onClick={() => setWsSyncEnabled(!wsSyncEnabled)}
                                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-opacity-75 ${wsSyncEnabled ? 'bg-primary' : 'bg-slate-700'}`}
                                            role="switch"
                                            aria-checked={wsSyncEnabled}
                                        >
                                            <span className="sr-only">Usar configuração de Sincronização</span>
                                            <span
                                                aria-hidden="true"
                                                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${wsSyncEnabled ? 'translate-x-4' : 'translate-x-0'}`}
                                            />
                                        </button>
                                    </div>
                                    <div>
                                        <label className="block text-xs text-slate-500 mb-2">Cor</label>
                                        <div className="flex gap-2 flex-wrap">
                                            {COLORS.map(c => (
                                                <button key={c} onClick={() => setWsColor(c)}
                                                    className={`w-7 h-7 rounded-full transition-transform ${wsColor === c ? 'scale-125 ring-2 ring-white' : 'hover:scale-110'}`}
                                                    style={{ backgroundColor: c }}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex gap-3">
                                    <button onClick={handleSaveWorkspace} disabled={savingWs || !wsName.trim()}
                                        className="flex-1 flex items-center justify-center gap-2 py-2 bg-primary hover:bg-blue-600 disabled:opacity-50 text-sm font-semibold rounded-lg transition-colors">
                                        <Save className="w-4 h-4" />
                                        {savingWs ? 'Salvando...' : 'Salvar'}
                                    </button>
                                    <button onClick={() => setConfirmDeleteWs(true)}
                                        className="px-4 py-2 text-red-400 hover:bg-red-500/10 text-sm font-semibold rounded-lg transition-colors border border-red-500/30">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <p className="text-sm text-slate-400 mb-2">Excluir <strong className="text-white">{workspace.name}</strong>?</p>
                                <p className="text-xs text-red-400 mb-6">Todos os servidores serão excluídos permanentemente.</p>
                                <div className="flex gap-3">
                                    <button onClick={() => setConfirmDeleteWs(false)} className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-sm font-semibold rounded-lg transition-colors">Cancelar</button>
                                    <button onClick={handleDeleteWorkspace} className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-sm font-semibold rounded-lg transition-colors">Excluir</button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* ── Delete Server Confirmation ── */}
            {confirmDeleteServerId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 w-96 shadow-2xl">
                        <h2 className="text-lg font-semibold mb-2 text-red-400">Excluir servidor?</h2>
                        <p className="text-sm text-slate-400 mb-6">Esta ação não pode ser desfeita.</p>
                        <div className="flex gap-3">
                            <button onClick={() => setConfirmDeleteServerId(null)} className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-sm font-semibold rounded-lg transition-colors">Cancelar</button>
                            <button onClick={() => handleDeleteServer(confirmDeleteServerId)} className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-sm font-semibold rounded-lg transition-colors">Excluir</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WorkspaceDetail;
