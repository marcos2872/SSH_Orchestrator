import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Plus, Server, Folder, Activity, MoreHorizontal, Pencil, Trash2, Check, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useToast } from '../hooks/useToast';

interface Workspace {
    id: string;
    name: string;
    color: string;
}

interface Props {
    onSelectWorkspace: (ws: Workspace | null) => void;
    selectedId?: string;
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

const Sidebar: React.FC<Props> = ({ onSelectWorkspace, selectedId }) => {
    const toast = useToast();
    const [collapsed, setCollapsed] = useState(false);
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [showSettings, setShowSettings] = useState(false);
    const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editName, setEditName] = useState('');
    const [editColor, setEditColor] = useState('');
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const editInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => { loadWorkspaces(); }, []);

    useEffect(() => {
        if (editingId && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    }, [editingId]);

    const loadWorkspaces = async () => {
        try {
            const res = await invoke<Workspace[]>('get_workspaces');
            setWorkspaces(res);
        } catch (err) {
            toast.error(`Erro ao carregar workspaces: ${err}`);
        }
    };

    const handleCreateWorkspace = async () => {
        try {
            await invoke('create_workspace', { name: 'Novo Workspace', color: '#3b82f6' });
            loadWorkspaces();
            // Auto-expand when creating
            setCollapsed(false);
        } catch (err) {
            toast.error(`Erro ao criar workspace: ${err}`);
        }
    };

    const handleStartEdit = (ws: Workspace, e: React.MouseEvent) => {
        e.stopPropagation();
        setMenuOpenId(null);
        setEditingId(ws.id);
        setEditName(ws.name);
        setEditColor(ws.color);
    };

    const handleSaveEdit = async () => {
        if (!editingId) return;
        try {
            await invoke('update_workspace', { id: editingId, name: editName, color: editColor });
            const updated = workspaces.find(w => w.id === editingId);
            if (updated && selectedId === editingId) {
                onSelectWorkspace({ ...updated, name: editName, color: editColor });
            }
            await loadWorkspaces();
            toast.success('Workspace atualizado!');
        } catch (err) {
            toast.error(`Erro ao atualizar workspace: ${err}`);
        } finally {
            setEditingId(null);
        }
    };

    const handleDeleteWorkspace = async (id: string) => {
        try {
            await invoke('delete_workspace', { id });
            if (selectedId === id) onSelectWorkspace(null);
            await loadWorkspaces();
            toast.success('Workspace excluído.');
        } catch (err) {
            toast.error(`Erro ao excluir workspace: ${err}`);
        } finally {
            setConfirmDeleteId(null);
            setMenuOpenId(null);
        }
    };

    return (
        <>
            <div
                className={`
                    bg-secondary h-screen border-r border-slate-700 flex flex-col
                    transition-all duration-300 ease-in-out overflow-hidden shrink-0
                    ${collapsed ? 'w-14' : 'w-64'}
                `}
            >
                {/* ── Header ── */}
                <div className={`flex items-center border-b border-slate-700/50 shrink-0 ${collapsed ? 'justify-center p-3' : 'justify-between p-4'}`}>
                    {!collapsed && (
                        <h1 className="text-xl font-bold flex items-center gap-2 whitespace-nowrap overflow-hidden">
                            <Activity className="text-primary w-6 h-6 shrink-0" />
                            SSH Config
                        </h1>
                    )}
                    {collapsed && (
                        <Activity className="text-primary w-6 h-6 shrink-0" />
                    )}
                    {!collapsed && (
                        <button
                            onClick={() => setCollapsed(true)}
                            title="Colapsar sidebar"
                            className="p-1 hover:bg-slate-700 rounded-md transition-colors"
                        >
                            <ChevronLeft className="w-5 h-5 text-slate-400" />
                        </button>
                    )}
                </div>

                {/* ── Collapsed: icon strip ── */}
                {collapsed && (
                    <div className="flex flex-col items-center gap-2 pt-3 flex-1 overflow-y-auto">
                        {/* Expand button */}
                        <button
                            onClick={() => setCollapsed(false)}
                            title="Expandir sidebar"
                            className="p-2 hover:bg-slate-700 rounded-md transition-colors mb-1"
                        >
                            <ChevronRight className="w-4 h-4 text-slate-400" />
                        </button>

                        {/* Workspace dots */}
                        {workspaces.map((ws) => (
                            <button
                                key={ws.id}
                                title={ws.name}
                                onClick={() => { onSelectWorkspace(ws); setCollapsed(false); }}
                                className={`
                                    w-8 h-8 rounded-lg flex items-center justify-center transition-all
                                    ${selectedId === ws.id ? 'ring-2 ring-white/30 scale-110' : 'hover:scale-110'}
                                `}
                                style={{ backgroundColor: ws.color + '33', border: `2px solid ${ws.color}` }}
                            >
                                <span
                                    className="text-[10px] font-bold uppercase"
                                    style={{ color: ws.color }}
                                >
                                    {ws.name.charAt(0)}
                                </span>
                            </button>
                        ))}

                        {/* New workspace (collapsed) */}
                        <button
                            onClick={handleCreateWorkspace}
                            title="Novo Workspace"
                            className="p-2 hover:bg-slate-700 rounded-md transition-colors mt-auto mb-3"
                        >
                            <Plus className="w-4 h-4 text-slate-500" />
                        </button>
                    </div>
                )}

                {/* ── Expanded: full list ── */}
                {!collapsed && (
                    <>
                        <nav className="flex-1 overflow-y-auto space-y-1 p-4">
                            <div className="flex items-center justify-between mb-4 px-2">
                                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                    Workspaces
                                </span>
                                <button
                                    onClick={handleCreateWorkspace}
                                    title="Novo Workspace"
                                    className="p-0.5 hover:bg-slate-700 rounded transition-colors"
                                >
                                    <Plus className="w-3.5 h-3.5 text-slate-500 hover:text-slate-300" />
                                </button>
                            </div>

                            {workspaces.map((ws) => (
                                <div key={ws.id} className="relative group">
                                    {editingId === ws.id ? (
                                        <div className="px-2 py-2 space-y-2">
                                            <input
                                                ref={editInputRef}
                                                value={editName}
                                                onChange={e => setEditName(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') setEditingId(null); }}
                                                className="w-full bg-slate-800 border border-primary/50 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                                            />
                                            <div className="flex gap-1 flex-wrap">
                                                {COLORS.map(c => (
                                                    <button
                                                        key={c}
                                                        onClick={() => setEditColor(c)}
                                                        className={`w-5 h-5 rounded-full transition-transform ${editColor === c ? 'scale-125 ring-2 ring-white' : ''}`}
                                                        style={{ backgroundColor: c }}
                                                    />
                                                ))}
                                            </div>
                                            <div className="flex gap-2">
                                                <button onClick={handleSaveEdit} className="flex-1 flex items-center justify-center gap-1 py-1 text-xs bg-primary hover:bg-blue-600 rounded transition-colors">
                                                    <Check className="w-3 h-3" /> Salvar
                                                </button>
                                                <button onClick={() => setEditingId(null)} className="flex-1 flex items-center justify-center gap-1 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded transition-colors">
                                                    <X className="w-3 h-3" /> Cancelar
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div
                                            onClick={() => { setMenuOpenId(null); onSelectWorkspace(ws); }}
                                            className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all ${selectedId === ws.id ? 'bg-primary/20 text-white' : 'hover:bg-slate-800'}`}
                                        >
                                            <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: ws.color }} />
                                            <span className="flex-1 text-sm font-medium truncate">{ws.name}</span>
                                            <button
                                                onClick={e => { e.stopPropagation(); setMenuOpenId(menuOpenId === ws.id ? null : ws.id); }}
                                                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-slate-700 transition-all"
                                            >
                                                <MoreHorizontal className="w-4 h-4 text-slate-400" />
                                            </button>
                                        </div>
                                    )}

                                    {menuOpenId === ws.id && (
                                        <div className="absolute right-0 top-8 z-50 w-40 bg-slate-800 border border-slate-700 rounded-lg shadow-xl py-1 text-sm" onClick={e => e.stopPropagation()}>
                                            <button onClick={e => handleStartEdit(ws, e)} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-700 text-left transition-colors">
                                                <Pencil className="w-4 h-4 text-slate-400" /> Renomear
                                            </button>
                                            <button onClick={() => setConfirmDeleteId(ws.id)} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-red-500/20 text-red-400 text-left transition-colors">
                                                <Trash2 className="w-4 h-4" /> Excluir
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))}

                            {workspaces.length === 0 && (
                                <div className="px-3 py-8 text-center">
                                    <Folder className="w-8 h-8 text-slate-600 mx-auto mb-2 opacity-50" />
                                    <p className="text-xs text-slate-500">Nenhum workspace encontrado</p>
                                </div>
                            )}
                        </nav>

                        {/* Footer */}
                        <div className="p-4 border-t border-slate-700">
                            <div onClick={() => setShowSettings(true)} className="flex items-center gap-3 px-3 py-2 text-slate-400 hover:text-white cursor-pointer rounded-lg hover:bg-slate-800 transition-colors">
                                <Server className="w-5 h-5 shrink-0" />
                                <span className="text-sm">Configuração</span>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Settings modal */}
            {showSettings && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 w-96 shadow-2xl">
                        <h2 className="text-lg font-semibold mb-2">Configurações</h2>
                        <p className="text-sm text-slate-400 mb-6">
                            Configurações avançadas (Master Password, GitHub Sync) estarão disponíveis nas Phases 0.2 e 0.3. 🔐
                        </p>
                        <button onClick={() => setShowSettings(false)} className="w-full py-2 bg-primary hover:bg-blue-600 text-white text-sm font-semibold rounded-lg transition-colors">
                            Fechar
                        </button>
                    </div>
                </div>
            )}

            {/* Delete confirmation modal */}
            {confirmDeleteId && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
                    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 w-96 shadow-2xl">
                        <h2 className="text-lg font-semibold mb-2 text-red-400">Excluir workspace?</h2>
                        <p className="text-sm text-slate-400 mb-6">
                            Esta ação irá excluir o workspace e <strong className="text-white">todos os servidores</strong> associados. Não pode ser desfeita.
                        </p>
                        <div className="flex gap-3">
                            <button onClick={() => { setConfirmDeleteId(null); setMenuOpenId(null); }} className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-sm font-semibold rounded-lg transition-colors">
                                Cancelar
                            </button>
                            <button onClick={() => handleDeleteWorkspace(confirmDeleteId)} className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-sm font-semibold rounded-lg transition-colors">
                                Excluir
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {menuOpenId && <div className="fixed inset-0 z-40" onClick={() => setMenuOpenId(null)} />}
        </>
    );
};

export default Sidebar;
