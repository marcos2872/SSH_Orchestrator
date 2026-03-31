import React, { useState, useRef, useEffect } from "react";
import {
  Cloud,
  CloudOff,
  RefreshCw,
  CheckCircle2,
  Download,
  Upload,
  AlertTriangle,
} from "lucide-react";
import Modal from "../Modal";

export type SyncState = "idle" | "syncing" | "success" | "error" | "offline";

interface Props {
  state: SyncState;
  /** Granular progress detail emitted by the backend via `sync://progress`. */
  detail?: string;
  lastSyncTime?: Date;
  onPull?: () => void;
  onPush?: () => void;
}

const SyncStatus: React.FC<Props> = ({
  state,
  detail,
  lastSyncTime,
  onPull,
  onPush,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showPushConfirm, setShowPushConfirm] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const getIcon = () => {
    switch (state) {
      case "syncing":
        return <RefreshCw className="w-3.5 h-3.5 animate-spin" style={{ color: "#0a84ff" }} />;
      case "success":
        return <CheckCircle2 className="w-3.5 h-3.5" style={{ color: "#32d74b" }} />;
      case "error":
      case "offline":
        return <CloudOff className="w-3.5 h-3.5" style={{ color: "#ff453a" }} />;
      case "idle":
      default:
        return <Cloud className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.4)" }} />;
    }
  };

  const getLabel = () => {
    switch (state) {
      case "syncing":
        return detail || "Sincronizando...";
      case "success":
        return "Atualizado";
      case "error":
        return "Erro na sincronização";
      case "offline":
        return "Modo Offline";
      case "idle":
      default:
        return "Sincronização";
    }
  };

  const confirmPush = () => {
    setShowPushConfirm(false);
    if (onPush) onPush();
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setDropdownOpen((o) => !o)}
        disabled={state === "syncing" || state === "offline"}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all text-xs font-medium disabled:opacity-50"
        style={{
          background: "rgba(255,255,255,0.06)",
          border: "0.5px solid rgba(255,255,255,0.1)",
          color: "rgba(255,255,255,0.7)",
        }}
        onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.background = "rgba(255,255,255,0.09)"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; }}
        title={
          lastSyncTime
            ? `Última sincronização: ${lastSyncTime.toLocaleTimeString()}`
            : "Pronto para usar nuvem"
        }
      >
        {getIcon()}
        <span>{getLabel()}</span>
        {state !== "offline" && state !== "syncing" && (
          <svg
            width="10"
            height="6"
            viewBox="0 0 10 6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className={`transition-transform`}
            style={{ opacity: 0.5, transform: dropdownOpen ? "rotate(180deg)" : "rotate(0deg)" }}
          >
            <polyline points="1,1 5,5 9,1" />
          </svg>
        )}
      </button>

      {dropdownOpen && state !== "syncing" && state !== "offline" && (
        <div
          className="absolute right-0 top-full mt-2 w-56 rounded-2xl shadow-2xl overflow-hidden z-50"
          style={{
            background: "rgba(44,44,46,0.92)",
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
            border: "0.5px solid rgba(255,255,255,0.12)",
          }}
        >
          <div
            className="p-2 flex flex-col gap-1"
            style={{ borderBottom: "0.5px solid rgba(255,255,255,0.08)" }}
          >
            <span
              className="text-[11px] font-medium px-2 py-1"
              style={{ color: "rgba(255,255,255,0.35)" }}
            >
              Ações Manuais
            </span>
          </div>

          <button
            onClick={() => {
              setDropdownOpen(false);
              if (onPull) onPull();
            }}
            className="w-full flex items-start gap-3 px-3 py-3 text-left transition-colors"
            style={{ color: "rgba(255,255,255,0.75)" }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "#ffffff"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.75)"; }}
          >
            <Download className="w-4 h-4 mt-0.5" style={{ color: "#0a84ff" }} />
            <div>
              <span className="block text-sm font-medium">
                Baixar do GitHub
              </span>
              <span className="block text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>
                Sobrescreve alterações locais com a Nuvem
              </span>
            </div>
          </button>

          <button
            onClick={() => {
              setDropdownOpen(false);
              setShowPushConfirm(true);
            }}
            className="w-full flex items-start gap-3 px-3 py-3 text-left transition-colors"
            style={{
              color: "rgba(255,255,255,0.75)",
              borderTop: "0.5px solid rgba(255,255,255,0.06)",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "#ffffff"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.75)"; }}
          >
            <Upload className="w-4 h-4 mt-0.5" style={{ color: "#ff9f0a" }} />
            <div>
              <span className="block text-sm font-medium">Forçar Envio</span>
              <span className="block text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>
                Envia o local exato ignorando a nuvem
              </span>
            </div>
          </button>
        </div>
      )}

      <Modal
        isOpen={showPushConfirm}
        onClose={() => setShowPushConfirm(false)}
        title="Atenção"
        icon={<AlertTriangle className="w-5 h-5" style={{ color: "#ff9f0a" }} />}
      >
        <div className="mb-6">
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.65)" }}>
            Fazer PUSH irá{" "}
            <strong className="text-white">
              forçar o estado do seu PC atual
            </strong>{" "}
            para a nuvem, sobrescrevendo alterações de outros computadores.
            Deseja continuar?
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowPushConfirm(false)}
            className="flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all active:scale-[0.98]"
            style={{ background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.8)" }}
          >
            Cancelar
          </button>
          <button
            onClick={confirmPush}
            className="flex-1 py-2.5 text-sm font-semibold text-white rounded-xl transition-all active:scale-[0.98]"
            style={{
              background: "#ff9f0a",
              boxShadow: "0 4px 12px rgba(255,159,10,0.3)",
            }}
          >
            Forçar Envio
          </button>
        </div>
      </Modal>
    </div>
  );
};

export default SyncStatus;
