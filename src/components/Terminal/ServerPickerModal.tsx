import React, { useEffect, useState } from 'react';
import { Server as ServerIcon } from 'lucide-react';
import Modal from '../Modal';
import { Spinner } from '../ui';
import { getServers, type Server } from '../../lib/api/servers';
import { getWorkspaces } from '../../lib/api/workspaces';

interface Props {
    isOpen: boolean;
    workspaceId: string | null;
    onSelect: (server: Server) => void;
    onClose: () => void;
}

interface ServerGroup {
    workspace: string;
    servers: Server[];
}

const ServerPickerModal: React.FC<Props> = ({ isOpen, workspaceId, onSelect, onClose }) => {
    const [groups, setGroups] = useState<ServerGroup[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!isOpen) return;
        setLoading(true);
        const load = async () => {
            // Com workspace selecionado, lista só dele; sem workspace, agrupa todos
            if (workspaceId) {
                const servers = await getServers(workspaceId).catch(() => [] as Server[]);
                setGroups(servers.length > 0 ? [{ workspace: '', servers }] : []);
            } else {
                const workspaces = await getWorkspaces().catch(() => []);
                const all = await Promise.all(
                    workspaces.map(async (ws) => ({
                        workspace: ws.name,
                        servers: await getServers(ws.id).catch(() => [] as Server[]),
                    })),
                );
                setGroups(all.filter((g) => g.servers.length > 0));
            }
        };
        load()
            .catch(() => setGroups([]))
            .finally(() => setLoading(false));
    }, [isOpen, workspaceId]);

    const total = groups.reduce((n, g) => n + g.servers.length, 0);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={workspaceId ? "Nova aba — Selecionar servidor" : "Nova aba — Todos os servidores"}
            width="w-96"
        >
            <div className="max-h-72 overflow-y-auto -mx-8 -mb-8">
                {loading && (
                    <div className="flex items-center justify-center gap-2 py-10 text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                        <Spinner size="w-4 h-4" />
                        Carregando...
                    </div>
                )}
                {!loading && total === 0 && (
                    <div className="px-4 py-8 text-center text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                        {workspaceId ? "Nenhum servidor neste workspace" : "Nenhum servidor em nenhum workspace"}
                    </div>
                )}
                {!loading && groups.map((group) => (
                    <div key={group.workspace || 'default'}>
                        {group.workspace && (
                            <p
                                className="px-6 pt-3 pb-1 text-[11px] font-medium"
                                style={{ color: "rgba(235,235,245,0.4)" }}
                            >
                                {group.workspace}
                            </p>
                        )}
                        {group.servers.map(srv => (
                            <button
                                key={srv.id}
                                onClick={() => onSelect(srv)}
                                className="w-full flex items-center gap-3 px-6 py-3 text-left group last:rounded-b-[20px] transition-colors"
                                style={{ color: "rgba(255,255,255,0.85)" }}
                                onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
                            >
                                <span
                                    className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                                    style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.55)" }}
                                ><ServerIcon className="w-4 h-4" /></span>
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
                ))}
            </div>
        </Modal>
    );
};

export default ServerPickerModal;
