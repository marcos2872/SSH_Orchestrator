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
        return <RefreshCw className="w-4 h-4 text-blue-400 animate-spin" />;
      case "success":
        return <CheckCircle2 className="w-4 h-4 text-green-400" />;
      case "error":
      case "offline":
        return <CloudOff className="w-4 h-4 text-red-400" />;
      case "idle":
      default:
        return <Cloud className="w-4 h-4 text-slate-400" />;
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
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/50 hover:bg-slate-700/50 transition-colors border border-slate-700 font-medium text-xs text-slate-300 disabled:opacity-50"
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
            className={`transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
          >
            <polyline points="1,1 5,5 9,1" />
          </svg>
        )}
      </button>

      {dropdownOpen && state !== "syncing" && state !== "offline" && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-slate-800 border border-slate-700 rounded-lg shadow-xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2">
          <div className="p-2 border-b border-slate-700/50 flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-400 px-2 py-1 uppercase tracking-wider">
              Ações Manuais
            </span>
          </div>

          <button
            onClick={() => {
              setDropdownOpen(false);
              if (onPull) onPull();
            }}
            className="w-full flex items-start gap-3 px-3 py-3 text-left hover:bg-slate-700/50 transition-colors text-slate-300 hover:text-white"
          >
            <Download className="w-4 h-4 mt-0.5 text-blue-400" />
            <div>
              <span className="block text-sm font-medium">
                Baixar do GitHub
              </span>
              <span className="block text-xs text-slate-500 mt-0.5">
                Sobrescreve alterações locais com a Nuvem
              </span>
            </div>
          </button>

          <button
            onClick={() => {
              setDropdownOpen(false);
              setShowPushConfirm(true);
            }}
            className="w-full flex items-start gap-3 px-3 py-3 text-left hover:bg-slate-700/50 transition-colors border-t border-slate-700/50 text-slate-300 hover:text-white"
          >
            <Upload className="w-4 h-4 mt-0.5 text-orange-400" />
            <div>
              <span className="block text-sm font-medium">Forçar Envio</span>
              <span className="block text-xs text-slate-500 mt-0.5">
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
        icon={<AlertTriangle className="w-5 h-5 text-orange-400" />}
      >
        <div className="mb-6">
          <p className="text-sm text-slate-300">
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
            className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-sm font-semibold text-white rounded-lg transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={confirmPush}
            className="flex-1 py-2.5 bg-orange-600 hover:bg-orange-700 text-sm font-semibold text-white rounded-lg transition-colors"
          >
            Forçar Envio
          </button>
        </div>
      </Modal>
    </div>
  );
};

export default SyncStatus;
