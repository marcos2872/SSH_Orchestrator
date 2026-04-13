import React, { useEffect, useState } from "react";
import { updateWorkspace, deleteWorkspace } from "../../lib/api/workspaces";
import { Server, getServers, deleteServer } from "../../lib/api/servers";
import {
  Monitor,
  Plus,
  Settings,
  Shield,
  Terminal as TerminalIcon,
  HardDrive,
  Trash2,
  Save,
  Pencil,
  Lock,
  Key,
} from "lucide-react";
import { useToast } from "../../hooks/useToast";
import AddServerModal from "../Servers/AddServerModal";
import Modal from "../Modal";

interface Props {
  workspace: { id: string; name: string; color: string; sync_enabled?: boolean };
  onConnect: (server: Server) => void;
  onSftp: (server: Server) => void;
  onOpenLocal: () => void;
  onWorkspaceUpdated: (ws: { id: string; name: string; color: string; sync_enabled?: boolean }) => void;
  onWorkspaceDeleted: () => void;
}

const COLORS = [
  "#0a84ff",
  "#32d74b",
  "#ff9f0a",
  "#ff453a",
  "#bf5af2",
  "#ff375f",
  "#64d2ff",
  "#30d158",
];

const WorkspaceDetail: React.FC<Props> = ({
  workspace,
  onConnect,
  onSftp,
  onOpenLocal,
  onWorkspaceUpdated,
  onWorkspaceDeleted,
}) => {
  const toast = useToast();
  const [servers, setServers] = useState<Server[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingServer, setEditingServer] = useState<Server | null>(null);
  const [confirmDeleteServerId, setConfirmDeleteServerId] = useState<
    string | null
  >(null);

  const [wsName, setWsName] = useState(workspace.name);
  const [wsColor, setWsColor] = useState(workspace.color);
  const [wsSyncEnabled, setWsSyncEnabled] = useState(
    workspace.sync_enabled ?? false,
  );
  const [savingWs, setSavingWs] = useState(false);
  const [confirmDeleteWs, setConfirmDeleteWs] = useState(false);

  useEffect(() => {
    loadServers();
    const handleUpdate = () => loadServers();
    window.addEventListener("workspaces-updated", handleUpdate);
    return () => window.removeEventListener("workspaces-updated", handleUpdate);
  }, [workspace.id]);

  useEffect(() => {
    setWsName(workspace.name);
    setWsColor(workspace.color);
    setWsSyncEnabled(workspace.sync_enabled ?? false);
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
      toast.success("Servidor excluído.");
      await loadServers();
    } catch (err) {
      toast.error(`Erro ao excluir servidor: ${err}`);
    }
  };

  const handleSaveWorkspace = async () => {
    setSavingWs(true);
    try {
      await updateWorkspace(workspace.id, wsName, wsColor, wsSyncEnabled);
      onWorkspaceUpdated({
        id: workspace.id,
        name: wsName,
        color: wsColor,
        sync_enabled: wsSyncEnabled,
      });
      window.dispatchEvent(new Event("workspaces-updated"));
      toast.success("Workspace atualizado!");
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
      toast.success("Workspace excluído.");
      window.dispatchEvent(new Event("workspaces-updated"));
      onWorkspaceDeleted();
    } catch (err) {
      toast.error(`Erro ao excluir workspace: ${err}`);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <header
        className="h-14 flex items-center justify-between px-6 shrink-0"
        style={{
          background: "rgba(28,28,30,0.6)",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          borderBottom: "0.5px solid rgba(255,255,255,0.08)",
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="p-1.5 rounded-xl"
            style={{ background: "rgba(10,132,255,0.15)" }}
          >
            <Monitor className="text-primary w-4 h-4" />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold text-white leading-tight">
              {workspace.name}
            </h2>
            <p className="text-[11px]" style={{ color: "rgba(235,235,245,0.4)" }}>
              {servers.length} servidor{servers.length !== 1 ? "es" : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-sm font-semibold text-white transition-colors"
            style={{ background: "#0a84ff" }}
            onMouseEnter={e => (e.currentTarget.style.background = "#409cff")}
            onMouseLeave={e => (e.currentTarget.style.background = "#0a84ff")}
          >
            <Plus className="w-3.5 h-3.5" />
            Adicionar Servidor
          </button>
          <button
            onClick={() => {
              setShowSettings(true);
              setConfirmDeleteWs(false);
            }}
            title="Configurações do Workspace"
            className="p-2 rounded-xl transition-colors"
            style={{ color: "rgba(255,255,255,0.4)" }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.08)";
              (e.currentTarget as HTMLButtonElement).style.color = "white";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.4)";
            }}
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Server grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div
            className="flex items-center justify-center py-20 text-sm"
            style={{ color: "rgba(235,235,245,0.35)" }}
          >
            Carregando servidores...
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {/* ── Fixed Local Shell card ── */}
            <div
              className="p-5 rounded-2xl transition-all group cursor-pointer"
              style={{
                background: "rgba(50,215,75,0.06)",
                border: "0.5px solid rgba(50,215,75,0.2)",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLDivElement).style.background = "rgba(50,215,75,0.1)";
                (e.currentTarget as HTMLDivElement).style.border = "0.5px solid rgba(50,215,75,0.35)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLDivElement).style.background = "rgba(50,215,75,0.06)";
                (e.currentTarget as HTMLDivElement).style.border = "0.5px solid rgba(50,215,75,0.2)";
              }}
            >
              <div className="flex items-start justify-between mb-4">
                <div
                  className="p-2 rounded-xl transition-colors"
                  style={{ background: "rgba(50,215,75,0.12)" }}
                >
                  <TerminalIcon className="w-4 h-4" style={{ color: "#32d74b" }} />
                </div>
              </div>
              <h3 className="font-semibold text-[15px] text-white mb-1">Terminal Local</h3>
              <p
                className="text-xs font-mono mb-4"
                style={{ color: "rgba(235,235,245,0.45)" }}
              >
                Shell do sistema
              </p>
              <div
                className="flex items-center gap-2 pt-4"
                style={{ borderTop: "0.5px solid rgba(255,255,255,0.07)" }}
              >
                <button
                  onClick={onOpenLocal}
                  className="flex-1 py-2 text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-2"
                  style={{ background: "rgba(50,215,75,0.12)", color: "#32d74b" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "rgba(50,215,75,0.2)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "rgba(50,215,75,0.12)")}
                >
                  <TerminalIcon className="w-3 h-3" /> Abrir
                </button>
              </div>
            </div>

            {servers.map((server) => (
              <div
                key={server.id}
                className="p-5 rounded-2xl transition-all group"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "0.5px solid rgba(255,255,255,0.08)",
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.07)";
                  (e.currentTarget as HTMLDivElement).style.border = "0.5px solid rgba(10,132,255,0.3)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.04)";
                  (e.currentTarget as HTMLDivElement).style.border = "0.5px solid rgba(255,255,255,0.08)";
                }}
              >
                <div className="flex items-start justify-between mb-4">
                  <div
                    className="p-2 rounded-xl transition-colors group-hover:bg-[rgba(10,132,255,0.15)]"
                    style={{ background: "rgba(255,255,255,0.06)" }}
                  >
                    <TerminalIcon
                      className="w-4 h-4 transition-colors group-hover:text-primary"
                      style={{ color: "rgba(255,255,255,0.45)" }}
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    {server.has_saved_password && (
                      <span title="Senha salva" className="p-1" style={{ color: "#32d74b" }}>
                        <Lock className="w-3 h-3" style={{ opacity: 0.7 }} />
                      </span>
                    )}
                    {server.has_saved_ssh_key && (
                      <span title="Chave SSH salva" className="p-1" style={{ color: "#0a84ff" }}>
                        <Key className="w-3 h-3" style={{ opacity: 0.7 }} />
                      </span>
                    )}
                    <button
                      onClick={() => setEditingServer(server)}
                      title="Editar servidor"
                      className="p-1 opacity-0 group-hover:opacity-100 rounded-lg transition-all"
                      style={{ color: "rgba(255,255,255,0.45)" }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.1)";
                        (e.currentTarget as HTMLButtonElement).style.color = "white";
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                        (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.45)";
                      }}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setConfirmDeleteServerId(server.id)}
                      title="Excluir servidor"
                      className="p-1 opacity-0 group-hover:opacity-100 rounded-lg transition-all"
                      style={{ color: "rgba(255,255,255,0.45)" }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,69,58,0.12)";
                        (e.currentTarget as HTMLButtonElement).style.color = "#ff453a";
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                        (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.45)";
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <h3 className="font-semibold text-[15px] text-white mb-1 truncate">
                  {server.name}
                </h3>
                <p
                  className="text-xs font-mono mb-4 truncate"
                  style={{ color: "rgba(235,235,245,0.4)" }}
                >
                  {server.username}@{server.host}:{server.port}
                </p>
                <div
                  className="flex items-center gap-2 pt-4"
                  style={{ borderTop: "0.5px solid rgba(255,255,255,0.07)" }}
                >
                  <button
                    onClick={() => onConnect(server)}
                    className="flex-1 py-2 text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-2 text-white/70"
                    style={{ background: "rgba(255,255,255,0.06)" }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLButtonElement).style.background = "rgba(10,132,255,0.15)";
                      (e.currentTarget as HTMLButtonElement).style.color = "#0a84ff";
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)";
                      (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.7)";
                    }}
                  >
                    <TerminalIcon className="w-3 h-3" /> Connect
                  </button>
                  <button
                    onClick={() => onSftp(server)}
                    title="SFTP"
                    className="px-3 py-2 text-xs font-semibold rounded-xl transition-colors text-white/70"
                    style={{ background: "rgba(255,255,255,0.06)" }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLButtonElement).style.background = "rgba(100,210,255,0.15)";
                      (e.currentTarget as HTMLButtonElement).style.color = "#64d2ff";
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)";
                      (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.7)";
                    }}
                  >
                    <HardDrive className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}

            {servers.length === 0 && (
              <div
                className="col-span-full py-20 text-center rounded-3xl"
                style={{
                  border: "1.5px dashed rgba(255,255,255,0.08)",
                }}
              >
                <Shield
                  className="w-10 h-10 mx-auto mb-4"
                  style={{ color: "rgba(255,255,255,0.12)" }}
                />
                <h3
                  className="font-medium mb-2"
                  style={{ color: "rgba(235,235,245,0.5)" }}
                >
                  Nenhum servidor neste workspace
                </h3>
                <p
                  className="text-sm mb-6"
                  style={{ color: "rgba(235,235,245,0.3)" }}
                >
                  Comece adicionando um novo host.
                </p>
                <button
                  onClick={() => setShowAddModal(true)}
                  className="text-sm font-semibold hover:underline"
                  style={{ color: "#0a84ff" }}
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
          onClose={() => {
            setShowAddModal(false);
            setEditingServer(null);
          }}
          onSaved={() => {
            setShowAddModal(false);
            setEditingServer(null);
            loadServers();
          }}
        />
      )}

      {/* ── Workspace Settings Modal ── */}
      <Modal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        title="Configurações do Workspace"
        width="w-[420px]"
      >
        {!confirmDeleteWs ? (
          <>
            <div className="space-y-5 mb-6">
              <div>
                <label
                  className="block text-[11px] font-medium mb-1.5"
                  style={{ color: "rgba(235,235,245,0.4)" }}
                >
                  Nome do Workspace
                </label>
                <input
                  value={wsName}
                  onChange={(e) => setWsName(e.target.value)}
                  className="w-full rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none"
                  style={{
                    background: "rgba(255,255,255,0.07)",
                    border: "0.5px solid rgba(255,255,255,0.1)",
                  }}
                  onFocus={e => (e.currentTarget.style.border = "0.5px solid rgba(10,132,255,0.7)")}
                  onBlur={e => (e.currentTarget.style.border = "0.5px solid rgba(255,255,255,0.1)")}
                />
              </div>
              <div className="flex items-center justify-between py-1">
                <label
                  className="text-[13px] font-medium"
                  style={{ color: "rgba(235,235,245,0.7)" }}
                >
                  Sincronizar no GitHub
                </label>
                <button
                  type="button"
                  onClick={() => setWsSyncEnabled(!wsSyncEnabled)}
                  className="relative inline-flex h-[22px] w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
                  style={{ background: wsSyncEnabled ? "#0a84ff" : "rgba(255,255,255,0.15)" }}
                  role="switch"
                  aria-checked={wsSyncEnabled}
                >
                  <span className="sr-only">Usar configuração de Sincronização</span>
                  <span
                    aria-hidden="true"
                    className="pointer-events-none inline-block h-[18px] w-[18px] transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out"
                    style={{ transform: wsSyncEnabled ? "translateX(18px)" : "translateX(0px)" }}
                  />
                </button>
              </div>
              <div>
                <label
                  className="block text-[11px] font-medium mb-2"
                  style={{ color: "rgba(235,235,245,0.4)" }}
                >
                  Cor
                </label>
                <div className="flex gap-2 flex-wrap">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setWsColor(c)}
                      className={`w-7 h-7 rounded-full transition-transform ${wsColor === c ? "scale-125 ring-2 ring-white/60" : "hover:scale-110"}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleSaveWorkspace}
                disabled={savingWs || !wsName.trim()}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 disabled:opacity-50 text-sm font-semibold text-white rounded-xl transition-colors"
                style={{ background: "#0a84ff" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#409cff")}
                onMouseLeave={e => (e.currentTarget.style.background = "#0a84ff")}
              >
                <Save className="w-4 h-4" />
                {savingWs ? "Salvando..." : "Salvar"}
              </button>
              <button
                onClick={() => setConfirmDeleteWs(true)}
                className="px-4 py-2.5 text-sm font-semibold rounded-xl transition-colors"
                style={{ color: "#ff453a", background: "rgba(255,69,58,0.1)", border: "0.5px solid rgba(255,69,58,0.25)" }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,69,58,0.18)")}
                onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,69,58,0.1)")}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm mb-2" style={{ color: "rgba(235,235,245,0.55)" }}>
              Excluir <strong className="text-white">{workspace.name}</strong>?
            </p>
            <p className="text-xs mb-6" style={{ color: "#ff453a" }}>
              Todos os servidores serão excluídos permanentemente.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDeleteWs(false)}
                className="flex-1 py-2.5 text-sm font-semibold rounded-xl transition-colors text-white/70"
                style={{ background: "rgba(255,255,255,0.08)" }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.14)")}
                onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
              >
                Cancelar
              </button>
              <button
                onClick={handleDeleteWorkspace}
                className="flex-1 py-2.5 text-sm font-semibold rounded-xl transition-colors text-white"
                style={{ background: "#ff453a" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#ff6961")}
                onMouseLeave={e => (e.currentTarget.style.background = "#ff453a")}
              >
                Excluir
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* ── Delete Server Confirmation ── */}
      <Modal
        isOpen={!!confirmDeleteServerId}
        onClose={() => setConfirmDeleteServerId(null)}
        title="Excluir servidor?"
        width="w-96"
      >
        <p className="text-sm mb-6" style={{ color: "rgba(235,235,245,0.55)" }}>
          Esta ação não pode ser desfeita.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => setConfirmDeleteServerId(null)}
            className="flex-1 py-2.5 text-sm font-semibold rounded-xl transition-colors text-white/70"
            style={{ background: "rgba(255,255,255,0.08)" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.14)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
          >
            Cancelar
          </button>
          <button
            onClick={() =>
              confirmDeleteServerId && handleDeleteServer(confirmDeleteServerId)
            }
            className="flex-1 py-2.5 text-sm font-semibold rounded-xl transition-colors text-white"
            style={{ background: "#ff453a" }}
            onMouseEnter={e => (e.currentTarget.style.background = "#ff6961")}
            onMouseLeave={e => (e.currentTarget.style.background = "#ff453a")}
          >
            Excluir
          </button>
        </div>
      </Modal>
    </div>
  );
};

export default WorkspaceDetail;
