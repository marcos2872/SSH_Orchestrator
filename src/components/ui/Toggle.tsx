import React from "react";

interface Props {
  checked: boolean;
  onChange: (val: boolean) => void;
  label: string;
  description?: string;
}

// Interruptor padrão do app (liga/desliga com rótulo e descrição)
const Toggle: React.FC<Props> = ({ checked, onChange, label, description }) => {
  return (
    <label className="flex items-start gap-3 cursor-pointer group">
      <span className="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
        />
        <span
          className={`block w-10 h-[22px] rounded-full transition-colors ${checked ? "bg-[#0a84ff]" : "bg-white/15"}`}
        />
        <span
          className="absolute top-0.5 w-[18px] h-[18px] bg-white rounded-full shadow-md transition-transform"
          style={{ transform: checked ? "translateX(20px)" : "translateX(2px)" }}
        />
      </span>
      <span>
        <span className="block text-sm font-medium text-white/75 group-hover:text-white/95 transition-colors">
          {label}
        </span>
        {description && (
          <span
            className="block text-xs mt-0.5"
            style={{ color: "rgba(235,235,245,0.35)" }}
          >
            {description}
          </span>
        )}
      </span>
    </label>
  );
};

export default Toggle;
