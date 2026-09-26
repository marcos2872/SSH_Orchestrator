import React from "react";

type Accent = "default" | "blue" | "red" | "green" | "cyan";

const accents: Record<Accent, string> = {
  default: "text-white/40 hover:bg-white/[0.08] hover:text-white",
  blue: "text-white/40 hover:bg-white/[0.08] hover:text-[#0a84ff]",
  red: "text-white/40 hover:bg-[#ff453a]/[0.12] hover:text-[#ff453a]",
  green: "text-white/40 hover:bg-white/[0.08] hover:text-[#32d74b]",
  cyan: "text-white/40 hover:bg-white/[0.08] hover:text-[#64d2ff]",
};

interface Props {
  title: string;
  accent?: Accent;
  disabled?: boolean;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  children: React.ReactNode;
}

// Botão somente-ícone com hover colorido por contexto
const IconButton: React.FC<Props> = ({
  title,
  accent = "default",
  disabled = false,
  onClick,
  className = "",
  children,
}) => {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`p-2 rounded-xl transition-colors disabled:opacity-30 ${accents[accent]} ${className}`}
    >
      {children}
    </button>
  );
};

export default IconButton;
