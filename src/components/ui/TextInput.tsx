import React, { useState } from "react";
import { AlertTriangle, Eye, EyeOff } from "lucide-react";

const inputCls =
  "w-full rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none transition-all bg-white/[0.07] border-[0.5px] border-white/10 focus:border-[#0a84ff]/70 focus:shadow-[0_0_0_3px_rgba(10,132,255,0.15)] placeholder:text-white/40";

interface Props {
  label: string;
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  type?: string;
  multiline?: boolean;
  rows?: number;
  mono?: boolean;
  error?: string;
  autoFocus?: boolean;
  autoComplete?: string;
  spellCheck?: boolean;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  /** Exibe botão de mostrar/ocultar para campos de senha */
  showToggle?: boolean;
}

// Campo de texto padrão do app (input ou textarea, com erro opcional)
const TextInput: React.FC<Props> = ({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  multiline = false,
  rows = 4,
  mono = false,
  error,
  autoFocus = false,
  autoComplete,
  spellCheck,
  onKeyDown,
  showToggle = false,
}) => {
  const [visible, setVisible] = useState(false);
  const inputType = showToggle ? (visible ? "text" : "password") : type;

  return (
    <div>
      <label
        className="block text-[11px] font-medium mb-1.5"
        style={{ color: "rgba(235,235,245,0.55)" }}
      >
        {label}
      </label>
      <div className="relative">
        {multiline ? (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            rows={rows}
            autoFocus={autoFocus}
            autoComplete={autoComplete}
            spellCheck={spellCheck}
            onKeyDown={onKeyDown}
            className={`${inputCls} resize-none leading-relaxed ${mono ? "font-mono text-xs" : ""}`}
          />
        ) : (
          <input
            type={inputType}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            autoFocus={autoFocus}
            autoComplete={autoComplete}
            spellCheck={spellCheck}
            onKeyDown={onKeyDown}
            className={`${inputCls} ${mono ? "font-mono" : ""} ${showToggle ? "pr-10" : ""}`}
          />
        )}
        {showToggle && (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            tabIndex={-1}
            className="absolute right-2.5 top-3 transition-colors text-white/35 hover:text-white/70"
          >
            {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
      {error && (
        <p className="mt-1.5 text-xs flex items-center gap-1 text-[#ff453a]">
          <AlertTriangle className="w-3 h-3 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
};

export default TextInput;
