import React, { useEffect, useState } from 'react';
import Modal from '../Modal';
import { getServers, type Server } from '../../lib/api/servers';

interface Props {
    isOpen: boolean;
    workspaceId: string | null;
    onSelect: (server: Server) => void;
    onClose: () => void;
}

const ServerPickerModal: React.FC<Props> = ({ isOpen, workspaceId, onSelect, onClose }) => {
    const [servers, setServers] = useState<Server[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!isOpen || !workspaceId) { setLoading(false); return; }
        setLoading(true);
        getServers(workspaceId)
            .then(setServers)
            .catch(() => setServers([]))
            .finally(() => setLoading(false));
    }, [isOpen, workspaceId]);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Nova aba — Selecionar servidor"
            width="w-96"
        >
            <div className="max-h-72 overflow-y-auto -mx-8 -mb-8">
                {loading && (
                    <div className="flex items-center justify-center py-10 text-slate-500 text-sm animate-pulse">
                        Carregando...
                    </div>
                )}
                {!loading && !workspaceId && (
                    <div className="px-4 py-8 text-center text-slate-500 text-sm">
                        Selecione um workspace primeiro
                    </div>
                )}
                {!loading && workspaceId && servers.length === 0 && (
                    <div className="px-4 py-8 text-center text-slate-500 text-sm">
                        Nenhum servidor neste workspace
                    </div>
                )}
                {!loading && servers.map(srv => (
                    <button
                        key={srv.id}
                        onClick={() => onSelect(srv)}
                        className="w-full flex items-center gap-3 px-6 py-3 hover:bg-slate-800 transition-colors text-left group last:rounded-b-2xl"
                    >
                        <span className="w-8 h-8 rounded-lg bg-slate-800 group-hover:bg-slate-700 flex items-center justify-center shrink-0 text-base">🖥</span>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-200 truncate">{srv.name}</p>
                            <p className="text-xs text-slate-500 font-mono truncate">{srv.username}@{srv.host}:{srv.port}</p>
                        </div>
                        <span className="text-sky-500 text-xs opacity-0 group-hover:opacity-100 transition-opacity shrink-0">Conectar →</span>
                    </button>
                ))}
            </div>
        </Modal>
    );
};

export default ServerPickerModal;
