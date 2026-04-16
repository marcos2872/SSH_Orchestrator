import React, { useEffect, useRef, useState } from "react";
import { isVaultConfigured, isVaultLocked } from "../lib/api/vault";
import {
  Workspace,
  getWorkspaces,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
} from "../lib/api/workspaces";
import {
  Plus,
  Server,
  Folder,
  Activity,
  MoreHorizontal,
  Pencil,
  Trash2,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  Github,
  Shield,
  LogOut,
  Loader2,
  ExternalLink,
  Lock,
  Keyboard,
} from "lucide-react";
import { useToast } from "../hooks/useToast";
import { useAuth } from "../hooks/useAuth";
import Modal from "./Modal";
import KeybindingsSection from "./Settings/KeybindingsSection";
import type { CustomKeybindings } from "../hooks/useKeybindings";
import type { KeyBinding, KeyAction } from "../lib/keybindings";

interface Props {
  onSelectWorkspace: (ws: Workspace | null) => void;
  selectedId?: string;
  /** Quando true, o sidebar colapsa automaticamente e bloqueia troca de workspace */
  hasTabs?: boolean;
  bindings: CustomKeybindings;
  onUpdateBinding: (action: KeyAction, binding: KeyBinding) => Promise<void>;
  onResetBindings: () => Promise<void>;
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

const Sidebar: React.FC<Props> = ({
  onSelectWorkspace,
  selectedId,
  hasTabs,
  bindings,
  onUpdateBinding,
  onResetBindings,
}) => {
  const toast = useToast();
  const { user, isLoading: authLoading, login, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Vault status (fetched when settings modal opens)
  const [vaultConfigured, setVaultConfigured] = useState(false);
  const [vaultLocked, setVaultLocked] = useState(true);
  const [vaultLoading, setVaultLoading] = useState(false);

  // GitHub action in progress
  const [githubActionLoading, setGithubActionLoading] = useState(false);

  useEffect(() => {
    loadWorkspaces();
    const handler = () => loadWorkspaces();
    window.addEventListener("workspaces-updated", handler);
    return () => window.removeEventListener("workspaces-updated", handler);
  }, []);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // Auto-colapsa quando uma conexão/aba é aberta
  useEffect(() => {
    if (hasTabs) setCollapsed(true);
  }, [hasTabs]);

  // Fetch vault status when settings modal opens
  useEffect(() => {
    if (!showSettings) return;
    setVaultLoading(true);
    Promise.all([
      isVaultConfigured(),
      isVaultLocked(),
    ])
      .then(([configured, locked]) => {
        setVaultConfigured(configured);
        setVaultLocked(locked);
      })
      .catch(() => {
        setVaultConfigured(false);
        setVaultLocked(true);
      })
      .finally(() => setVaultLoading(false));
  }, [showSettings]);

  const loadWorkspaces = async () => {
    try {
      const res = await getWorkspaces();
      setWorkspaces(res);
    } catch (err) {
      toast.error(`Erro ao carregar workspaces: ${err}`);
    }
  };

  const handleCreateWorkspace = async () => {
    try {
      await createWorkspace("Novo Workspace", "#0a84ff");
      loadWorkspaces();
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
      await updateWorkspace(editingId, editName, editColor);
      const updated = workspaces.find((w) => w.id === editingId);
      if (updated && selectedId === editingId) {
        onSelectWorkspace({ ...updated, name: editName, color: editColor });
      }
      await loadWorkspaces();
      toast.success("Workspace atualizado!");
    } catch (err) {
      toast.error(`Erro ao atualizar workspace: ${err}`);
    } finally {
      setEditingId(null);
    }
  };

  const handleDeleteWorkspace = async (id: string) => {
    try {
      await deleteWorkspace(id);
      if (selectedId === id) onSelectWorkspace(null);
      await loadWorkspaces();
      toast.success("Workspace excluído.");
    } catch (err) {
      toast.error(`Erro ao excluir workspace: ${err}`);
    } finally {
      setConfirmDeleteId(null);
      setMenuOpenId(null);
    }
  };

  const handleGitHubLogin = async () => {
    setGithubActionLoading(true);
    try {
      await login();
      toast.success("Conectado ao GitHub!");
    } catch (err) {
      toast.error(`Erro ao conectar: ${err}`);
    } finally {
      setGithubActionLoading(false);
    }
  };

  const handleGitHubLogout = async () => {
    setGithubActionLoading(true);
    try {
      await logout();
      toast.success("Desconectado do GitHub.");
    } catch (err) {
      toast.error(`Erro ao desconectar: ${err}`);
    } finally {
      setGithubActionLoading(false);
    }
  };

  return (
    <>
      <div
        className={`
          h-full flex flex-col
          transition-all duration-300 ease-in-out overflow-hidden shrink-0
          ${collapsed ? "w-14" : "w-64"}
        `}
        style={{
          background: "rgba(28, 28, 30, 0.72)",
          backdropFilter: "blur(20px) saturate(180%)",
          WebkitBackdropFilter: "blur(20px) saturate(180%)",
          borderRight: "0.5px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        {/* ── Header ── */}
        <div
          className={`flex items-center shrink-0 ${collapsed ? "justify-center p-3" : "justify-between p-4"}`}
          style={{ borderBottom: "0.5px solid rgba(255,255,255,0.07)" }}
        >
          {!collapsed && (
            <h1 className="text-[15px] font-semibold flex items-center gap-2 whitespace-nowrap overflow-hidden text-white/90">
              <Activity className="text-primary w-5 h-5 shrink-0" />
              SSH Config
            </h1>
          )}
          {collapsed && <Activity className="text-primary w-5 h-5 shrink-0" />}
          {!collapsed && (
            <button
              onClick={() => setCollapsed(true)}
              title="Colapsar sidebar"
              className="p-1 rounded-md transition-colors"
              style={{ color: "rgba(255,255,255,0.35)" }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* ── Collapsed: icon strip ── */}
        {collapsed && (
          <div className="flex flex-col items-center gap-2 pt-3 flex-1 overflow-y-auto">
            {/* Expand button */}
            <button
              onClick={() => { if (hasTabs) return; setCollapsed(false); }}
              title={hasTabs ? "Feche as conexões ativas para expandir" : "Expandir sidebar"}
              disabled={hasTabs}
              className={`p-2 rounded-lg transition-colors mb-1 ${hasTabs ? 'opacity-40 cursor-not-allowed' : ''}`}
              style={{ color: "rgba(255,255,255,0.4)" }}
              onMouseEnter={e => { if (!hasTabs) e.currentTarget.style.background = "rgba(255,255,255,0.08)"; }}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            {/* Workspace dots */}
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                title={hasTabs ? `${ws.name} — feche as conexões ativas para trocar de workspace` : ws.name}
                onClick={() => {
                  if (hasTabs) {
                    toast.info("Feche as conexões ativas para trocar de workspace.");
                    return;
                  }
                  onSelectWorkspace(ws);
                  setCollapsed(false);
                }}
                className={`
                  w-8 h-8 rounded-xl flex items-center justify-center transition-all
                  ${hasTabs ? "opacity-40 cursor-not-allowed" : selectedId === ws.id ? "ring-2 ring-white/25 scale-110" : "hover:scale-110"}
                `}
                style={{
                  backgroundColor: ws.color + "25",
                  border: `1.5px solid ${ws.color}60`,
                }}
              >
                <span
                  className="text-[10px] font-bold"
                  style={{ color: ws.color }}
                >
                  {ws.name.charAt(0)}
                </span>
              </button>
            ))}

            {/* New workspace (collapsed) — oculto quando há conexões ativas */}
            {!hasTabs && (
              <button
                onClick={handleCreateWorkspace}
                title="Novo Workspace"
                className="p-2 rounded-lg transition-colors mt-auto mb-3"
                style={{ color: "rgba(255,255,255,0.3)" }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <Plus className="w-4 h-4" />
              </button>
            )}
          </div>
        )}

        {/* ── Expanded: full list ── */}
        {!collapsed && (
          <>
            <nav className="flex-1 overflow-y-auto space-y-0.5 p-3">
              <div className="flex items-center justify-between mb-3 px-2">
                <span className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "rgba(235,235,245,0.4)" }}>
                  Workspaces
                  {hasTabs && (
                    <Lock
                      className="w-2.5 h-2.5"
                      style={{ color: "rgba(235,235,245,0.3)" }}
                    />
                  )}
                </span>
                <button
                  onClick={handleCreateWorkspace}
                  title="Novo Workspace"
                  className="p-0.5 rounded transition-colors"
                  style={{ color: "rgba(255,255,255,0.3)" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {workspaces.map((ws) => (
                <div key={ws.id} className="relative group">
                  {editingId === ws.id ? (
                    <div className="px-2 py-2 space-y-2">
                      <input
                        ref={editInputRef}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveEdit();
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="w-full rounded-lg px-2.5 py-1.5 text-sm focus:outline-none text-white"
                        style={{
                          background: "rgba(255,255,255,0.08)",
                          border: "0.5px solid rgba(10,132,255,0.6)",
                        }}
                      />
                      <div className="flex gap-1 flex-wrap">
                        {COLORS.map((c) => (
                          <button
                            key={c}
                            onClick={() => setEditColor(c)}
                            className={`w-5 h-5 rounded-full transition-transform ${editColor === c ? "scale-125 ring-2 ring-white/60" : ""}`}
                            style={{ backgroundColor: c }}
                          />
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={handleSaveEdit}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs font-semibold text-white rounded-lg transition-colors"
                          style={{ background: "#0a84ff" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "#409cff")}
                          onMouseLeave={e => (e.currentTarget.style.background = "#0a84ff")}
                        >
                          <Check className="w-3 h-3" /> Salvar
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs font-semibold rounded-lg transition-colors"
                          style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.7)" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.14)")}
                          onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
                        >
                          <X className="w-3 h-3" /> Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      onClick={() => {
                        if (hasTabs) {
                          toast.info("Feche as conexões ativas para trocar de workspace.");
                          return;
                        }
                        setMenuOpenId(null);
                        onSelectWorkspace(ws);
                      }}
                      className="flex items-center gap-3 px-3 py-2 rounded-xl transition-all"
                      style={{
                        cursor: hasTabs ? "not-allowed" : "pointer",
                        background: selectedId === ws.id ? "rgba(255,255,255,0.1)" : "transparent",
                        color: hasTabs
                          ? "rgba(255,255,255,0.3)"
                          : selectedId === ws.id
                          ? "white"
                          : "rgba(255,255,255,0.7)",
                      }}
                      onMouseEnter={e => {
                        if (hasTabs || selectedId === ws.id) return;
                        (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.06)";
                      }}
                      onMouseLeave={e => {
                        if (selectedId !== ws.id) (e.currentTarget as HTMLDivElement).style.background = "transparent";
                      }}
                    >
                      <div
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: ws.color }}
                      />
                      <span className="flex-1 text-[13px] font-medium truncate">
                        {ws.name}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenId(menuOpenId === ws.id ? null : ws.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded-md transition-all"
                        style={{ color: "rgba(255,255,255,0.5)" }}
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {menuOpenId === ws.id && (
                    <div
                      className="absolute right-0 top-8 z-50 w-40 rounded-xl shadow-2xl py-1 text-sm overflow-hidden"
                      style={{
                        background: "rgba(44,44,46,0.92)",
                        backdropFilter: "blur(40px) saturate(180%)",
                        WebkitBackdropFilter: "blur(40px) saturate(180%)",
                        border: "0.5px solid rgba(255,255,255,0.12)",
                        boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={(e) => handleStartEdit(ws, e)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors text-white/80"
                        onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                      >
                        <Pencil className="w-4 h-4 opacity-60" /> Renomear
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(ws.id)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
                        style={{ color: "#ff453a" }}
                        onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,69,58,0.1)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                      >
                        <Trash2 className="w-4 h-4" /> Excluir
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {workspaces.length === 0 && (
                <div className="px-3 py-8 text-center">
                  <Folder className="w-8 h-8 mx-auto mb-2 opacity-20" style={{ color: "rgba(255,255,255,0.5)" }} />
                  <p className="text-xs" style={{ color: "rgba(235,235,245,0.35)" }}>
                    Nenhum workspace
                  </p>
                </div>
              )}
            </nav>

            {/* Footer */}
            <div className="p-3" style={{ borderTop: "0.5px solid rgba(255,255,255,0.07)" }}>
              <div
                onClick={() => setShowSettings(true)}
                className="flex items-center gap-3 px-3 py-2 rounded-xl cursor-pointer transition-colors"
                style={{ color: "rgba(255,255,255,0.45)" }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.06)";
                  (e.currentTarget as HTMLDivElement).style.color = "rgba(255,255,255,0.85)";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLDivElement).style.background = "transparent";
                  (e.currentTarget as HTMLDivElement).style.color = "rgba(255,255,255,0.45)";
                }}
              >
                <Server className="w-4 h-4 shrink-0" />
                <span className="text-[13px] font-medium">Configuração</span>
              </div>
            </div>
          </>
        )}
      {/* Backdrop para fechar o menu de contexto do workspace.
           Deve ficar DENTRO do mesmo <div> que tem backdropFilter para garantir
           que o dropdown (z-50) vença o backdrop (z-40) no mesmo stacking context. */}
      {menuOpenId && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setMenuOpenId(null)}
        />
      )}
      </div>

      {/* Settings modal */}
      <Modal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        title="Configurações"
        width="w-[420px]"
      >
        <div className="space-y-5">
          {/* ── Section: GitHub Sync ── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Github className="w-4 h-4" style={{ color: "rgba(255,255,255,0.4)" }} />
              <span className="text-[11px] font-medium" style={{ color: "rgba(235,235,245,0.4)" }}>
                GitHub Sync
              </span>
            </div>

            {authLoading ? (
              <div className="flex items-center justify-center py-6" style={{ color: "rgba(255,255,255,0.3)" }}>
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : user ? (
              <div
                className="rounded-2xl p-4"
                style={{ background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.1)" }}
              >
                <div className="flex items-center gap-3 mb-4">
                  <img
                    src={user.avatar_url}
                    alt={user.login}
                    className="w-10 h-10 rounded-full"
                    style={{ border: "0.5px solid rgba(255,255,255,0.2)" }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white truncate">
                      {user.name || user.login}
                    </p>
                    <p className="text-xs font-mono truncate" style={{ color: "rgba(235,235,245,0.4)" }}>
                      @{user.login}
                    </p>
                    {user.email && (
                      <p className="text-xs truncate" style={{ color: "rgba(235,235,245,0.35)" }}>
                        {user.email}
                      </p>
                    )}
                  </div>
                  <a
                    href={user.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Ver perfil no GitHub"
                    className="p-1.5 rounded-lg transition-colors shrink-0"
                    style={{ color: "rgba(255,255,255,0.4)" }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLAnchorElement).style.background = "rgba(255,255,255,0.08)";
                      (e.currentTarget as HTMLAnchorElement).style.color = "white";
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLAnchorElement).style.background = "transparent";
                      (e.currentTarget as HTMLAnchorElement).style.color = "rgba(255,255,255,0.4)";
                    }}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
                <div className="flex items-center gap-2 text-xs mb-4" style={{ color: "#32d74b" }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "#32d74b" }} />
                  Sync ativo — workspaces sincronizados automaticamente
                </div>
                <button
                  onClick={handleGitHubLogout}
                  disabled={githubActionLoading}
                  className="w-full flex items-center justify-center gap-2 py-2 text-xs font-semibold rounded-xl transition-colors disabled:opacity-50"
                  style={{ color: "#ff453a", background: "rgba(255,69,58,0.1)", border: "0.5px solid rgba(255,69,58,0.25)" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,69,58,0.18)")}
                  onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,69,58,0.1)")}
                >
                  {githubActionLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <LogOut className="w-3.5 h-3.5" />
                  )}
                  Desconectar
                </button>
              </div>
            ) : (
              <div
                className="rounded-2xl p-4"
                style={{ background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.1)" }}
              >
                <p className="text-sm mb-4" style={{ color: "rgba(235,235,245,0.55)" }}>
                  Conecte ao GitHub para sincronizar seus workspaces e
                  servidores entre dispositivos de forma segura.
                </p>
                <button
                  onClick={handleGitHubLogin}
                  disabled={githubActionLoading}
                  className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold rounded-xl transition-colors disabled:opacity-50 text-white"
                  style={{ background: "#0a84ff" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#409cff")}
                  onMouseLeave={e => (e.currentTarget.style.background = "#0a84ff")}
                >
                  {githubActionLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Github className="w-4 h-4" />
                  )}
                  Conectar com GitHub
                </button>
              </div>
            )}
          </div>

          {/* ── Section: Vault ── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Shield className="w-4 h-4" style={{ color: "rgba(255,255,255,0.4)" }} />
              <span className="text-[11px] font-medium" style={{ color: "rgba(235,235,245,0.4)" }}>
                Vault
              </span>
            </div>

            <div
              className="rounded-2xl p-4"
              style={{ background: "rgba(255,255,255,0.05)", border: "0.5px solid rgba(255,255,255,0.1)" }}
            >
              {vaultLoading ? (
                <div className="flex items-center justify-center py-4" style={{ color: "rgba(255,255,255,0.3)" }}>
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-lg">
                      {vaultConfigured ? (vaultLocked ? "🔒" : "🔓") : "⚠️"}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-white">
                        {vaultConfigured
                          ? vaultLocked
                            ? "Vault bloqueado"
                            : "Vault desbloqueado"
                          : "Vault não configurado"}
                      </p>
                      <p className="text-xs" style={{ color: "rgba(235,235,245,0.4)" }}>
                        {vaultConfigured
                          ? vaultLocked
                            ? "O vault está protegido. Reinicie o app para desbloquear."
                            : "Credenciais protegidas com AES-256-GCM."
                          : "Configure uma Master Password para proteger seus dados."}
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── Section: Teclas de Atalho ── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Keyboard className="w-4 h-4" style={{ color: "rgba(255,255,255,0.4)" }} />
              <span className="text-[11px] font-medium" style={{ color: "rgba(235,235,245,0.4)" }}>
                Teclas de Atalho
              </span>
            </div>
            <KeybindingsSection
              bindings={bindings}
              onUpdate={onUpdateBinding}
              onReset={onResetBindings}
            />
          </div>

          {/* ── Section: About ── */}
          <div>
            <div
              className="rounded-2xl p-4"
              style={{ background: "rgba(255,255,255,0.04)", border: "0.5px solid rgba(255,255,255,0.08)" }}
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl" style={{ background: "rgba(10,132,255,0.15)" }}>
                  <Activity className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white/80">
                    SSH Orchestrator
                  </p>
                  <p className="text-xs" style={{ color: "rgba(235,235,245,0.3)" }}>
                    v0.1.0 · Tauri + React + Rust
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* ── Close button ── */}
          <button
            onClick={() => setShowSettings(false)}
            className="w-full py-2.5 text-sm font-semibold rounded-xl transition-colors text-white/80"
            style={{ background: "rgba(255,255,255,0.08)" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.14)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
          >
            Fechar
          </button>
        </div>
      </Modal>

      {/* Delete confirmation modal */}
      <Modal
        isOpen={!!confirmDeleteId}
        onClose={() => {
          setConfirmDeleteId(null);
          setMenuOpenId(null);
        }}
        title="Excluir workspace?"
        width="w-96"
      >
        <p className="text-sm mb-6" style={{ color: "rgba(235,235,245,0.55)" }}>
          Esta ação irá excluir o workspace e{" "}
          <strong className="text-white">todos os servidores</strong>{" "}
          associados. Não pode ser desfeita.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => {
              setConfirmDeleteId(null);
              setMenuOpenId(null);
            }}
            className="flex-1 py-2.5 text-sm font-semibold rounded-xl transition-colors text-white/70"
            style={{ background: "rgba(255,255,255,0.08)" }}
            onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.14)")}
            onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.08)")}
          >
            Cancelar
          </button>
          <button
            onClick={() =>
              confirmDeleteId && handleDeleteWorkspace(confirmDeleteId)
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

    </>
  );
};

export default Sidebar;
