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
                    <div className="flex items-center justify-center py-10 text-xs animate-pulse" style={{ color: "rgba(255,255,255,0.35)" }}>
                        Carregando...
                    </div>
                )}
                {!loading && !workspaceId && (
                    <div className="px-4 py-8 text-center text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                        Selecione um workspace primeiro
                    </div>
                )}
                {!loading && workspaceId && servers.length === 0 && (
                    <div className="px-4 py-8 text-center text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                        Nenhum servidor neste workspace
                    </div>
                )}
                {!loading && servers.map(srv => (
                    <button
                        key={srv.id}
                        onClick={() => onSelect(srv)}
                        className="w-full flex items-center gap-3 px-6 py-3 text-left group last:rounded-b-[20px] transition-colors"
                        style={{ color: "rgba(255,255,255,0.85)" }}
                        onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                    >
                        <span
                            className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-base"
                            style={{ background: "rgba(255,255,255,0.07)" }}
                        >🖥</span>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{srv.name}</p>
                            <p className="text-xs font-mono truncate" style={{ color: "rgba(255,255,255,0.35)" }}>
                                {srv.username}@{srv.host}:{srv.port}
                            </p>
                        </div>
                        <span
                            className="text-xs opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                            style={{ color: "#0a84ff" }}
                        >Conectar →</span>
                    </button>
                ))}
            </div>
        </Modal>
    );
};

export default ServerPickerModal;
