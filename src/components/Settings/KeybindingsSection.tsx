import React, { useState, useEffect } from "react";
import { RotateCcw } from "lucide-react";
import type { KeyBinding, KeyAction } from "../../lib/keybindings";
import type { CustomKeybindings } from "../../hooks/useKeybindings";

interface Props {
  bindings: CustomKeybindings;
  onUpdate: (action: KeyAction, binding: KeyBinding) => Promise<void>;
  onReset: () => Promise<void>;
}

const LABELS: Record<KeyAction, string> = {
  NEW_TAB:     "Nova aba",
  CLOSE_TAB:   "Fechar aba",
  NEXT_TAB:    "Próxima aba",
  PREV_TAB:    "Aba anterior",
  SPLIT_H:     "Split horizontal",
  SPLIT_V:     "Split vertical",
  TOGGLE_SFTP: "Toggle SFTP",
};

// Ações exibidas na UI (TOGGLE_SFTP não está mais ativo)
const SHOWN: KeyAction[] = [
  "NEW_TAB", "CLOSE_TAB", "NEXT_TAB", "PREV_TAB", "SPLIT_H", "SPLIT_V",
];

const MODIFIER_KEYS = new Set([
  "Control", "Shift", "Alt", "Meta",
  // Aliases usados em alguns ambientes Linux/X11
  "Super", "Hyper", "OS",
]);

const KNOWN_MODIFIER_VALUES = new Set([
  "Control", "Shift", "Alt", "Meta", "Super", "Hyper", "OS",
]);

function formatBinding(b: KeyBinding): string {
  const parts: string[] = [];
  if (b.ctrl)  parts.push("Ctrl");
  if (b.meta)  parts.push("Super");
  if (b.alt)   parts.push("Alt");
  if (b.shift) parts.push("Shift");
  // Guarda adicional: se a key salva for um nome de modificador, exibe aviso
  if (KNOWN_MODIFIER_VALUES.has(b.key)) {
    parts.push(`⚠️${b.key}`);
  } else {
    parts.push(b.key === " " ? "Espaço" : b.key);
  }
  return parts.join("+");
}

function findConflict(
  action: KeyAction,
  b: KeyBinding,
  bindings: CustomKeybindings,
): KeyAction | null {
  for (const [k, cur] of Object.entries(bindings) as [KeyAction, KeyBinding][]) {
    if (k === action) continue;
    const same =
      cur.key === b.key &&
      (cur.ctrl  ?? false) === (b.ctrl  ?? false) &&
      (cur.shift ?? false) === (b.shift ?? false) &&
      (cur.alt   ?? false) === (b.alt   ?? false) &&
      (cur.meta  ?? false) === (b.meta  ?? false);
    if (same) return k;
  }
  return null;
}

// ── BindingRow ────────────────────────────────────────────────────────────────

interface RowProps {
  action: KeyAction;
  binding: KeyBinding;
  conflict: KeyAction | null;
  capturing: boolean;
  onCapture: () => void;
  onCancel: () => void;
}

function CapturingState({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <span className="text-xs animate-pulse" style={{ color: "#0a84ff" }}>
        Pressione uma tecla…
      </span>
      <button
        onClick={onCancel}
        className="text-xs px-2 py-1 rounded-lg transition-colors"
        style={{ color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.06)" }}
      >
        Cancelar
      </button>
    </div>
  );
}

function IdleState({
  binding, conflict, onCapture,
}: { binding: KeyBinding; conflict: KeyAction | null; onCapture: () => void }) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <kbd
        className="text-xs px-2 py-0.5 rounded-lg font-mono"
        style={{
          background: "rgba(255,255,255,0.08)",
          border: "0.5px solid rgba(255,255,255,0.15)",
          color: conflict ? "#ff9f0a" : "rgba(255,255,255,0.7)",
        }}
      >
        {formatBinding(binding)}
      </kbd>
      <button
        onClick={onCapture}
        className="text-xs px-2 py-1 rounded-lg transition-colors"
        style={{ color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.06)" }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.12)";
          e.currentTarget.style.color = "white";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,0.06)";
          e.currentTarget.style.color = "rgba(255,255,255,0.4)";
        }}
      >
        Editar
      </button>
    </div>
  );
}

function BindingRow({ action, binding, conflict, capturing, onCapture, onCancel }: RowProps) {
  return (
    <div
      className="flex items-center justify-between py-2 px-3 rounded-xl"
      style={{
        background: capturing
          ? "rgba(10,132,255,0.08)"
          : "rgba(255,255,255,0.04)",
      }}
    >
      <div className="flex-1 min-w-0">
        <span className="text-sm" style={{ color: "rgba(255,255,255,0.75)" }}>
          {LABELS[action]}
        </span>
        {conflict && (
          <span className="ml-2 text-xs" style={{ color: "#ff9f0a" }}>
            conflito com {LABELS[conflict]}
          </span>
        )}
      </div>
      {capturing
        ? <CapturingState onCancel={onCancel} />
        : <IdleState binding={binding} conflict={conflict} onCapture={onCapture} />
      }
    </div>
  );
}

// ── KeybindingsSection ────────────────────────────────────────────────────────

const KeybindingsSection: React.FC<Props> = ({ bindings, onUpdate, onReset }) => {
  const [capturing, setCapturing] = useState<KeyAction | null>(null);
  const [conflicts, setConflicts] = useState<Partial<Record<KeyAction, KeyAction>>>({});

  // Recalcula conflitos sempre que bindings mudar
  useEffect(() => {
    const next: Partial<Record<KeyAction, KeyAction>> = {};
    for (const action of SHOWN) {
      const c = findConflict(action, bindings[action], bindings);
      if (c) next[action] = c;
    }
    setConflicts(next);
  }, [bindings]);

  // Captura do próximo keydown quando em modo edição
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setCapturing(null); return; }
      if (MODIFIER_KEYS.has(e.key)) return;
      onUpdate(capturing, {
        key: e.key,
        ctrl:  e.ctrlKey  || undefined,
        shift: e.shiftKey || undefined,
        alt:   e.altKey   || undefined,
        meta:  e.metaKey  || undefined,
        description: bindings[capturing].description,
      }).catch(() => {});
      setCapturing(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, bindings, onUpdate]);

  return (
    <div
      className="rounded-2xl p-3 space-y-1"
      style={{
        background: "rgba(255,255,255,0.05)",
        border: "0.5px solid rgba(255,255,255,0.1)",
      }}
    >
      {SHOWN.map((action) => (
        <BindingRow
          key={action}
          action={action}
          binding={bindings[action]}
          conflict={conflicts[action] ?? null}
          capturing={capturing === action}
          onCapture={() => setCapturing(action)}
          onCancel={() => setCapturing(null)}
        />
      ))}
      <div className="pt-2 flex justify-end">
        <button
          onClick={() => onReset().catch(() => {})}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl transition-colors"
          style={{ color: "rgba(255,255,255,0.4)", background: "rgba(255,255,255,0.06)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.1)";
            e.currentTarget.style.color = "rgba(255,255,255,0.75)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.06)";
            e.currentTarget.style.color = "rgba(255,255,255,0.4)";
          }}
        >
          <RotateCcw className="w-3 h-3" />
          Restaurar padrões
        </button>
      </div>
    </div>
  );
};

export default KeybindingsSection;
