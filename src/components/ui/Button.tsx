import React from "react";
import Spinner from "./Spinner";

type Variant = "primary" | "secondary" | "danger" | "dangerGhost" | "warning";
type Size = "sm" | "md";

const variants: Record<Variant, string> = {
  primary: "bg-[#0a84ff] hover:bg-[#409cff] text-white",
  secondary: "bg-white/[0.08] hover:bg-white/[0.14] text-white/70",
  danger: "bg-[#ff453a] hover:bg-[#ff6961] text-white",
  dangerGhost:
    "text-[#ff453a] bg-[#ff453a]/10 border border-[#ff453a]/25 hover:bg-[#ff453a]/[0.18]",
  warning:
    "bg-[#ff9f0a] hover:bg-[#ff9f0a]/90 text-white shadow-[0_4px_12px_rgba(255,159,10,0.3)]",
};

const sizes: Record<Size, string> = {
  sm: "py-1.5 px-3 text-xs",
  md: "py-2.5 px-4 text-sm",
};

interface Props {
  variant?: Variant;
  size?: Size;
  type?: "button" | "submit";
  disabled?: boolean;
  loading?: boolean;
  onClick?: () => void;
  className?: string;
  children: React.ReactNode;
}

// Botão padrão do app (primário / secundário / perigo / aviso)
const Button: React.FC<Props> = ({
  variant = "primary",
  size = "md",
  type = "button",
  disabled = false,
  loading = false,
  onClick,
  className = "",
  children,
}) => {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`flex items-center justify-center gap-2 font-semibold rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
    >
      {loading && <Spinner size="w-4 h-4" />}
      {children}
    </button>
  );
};

export default Button;
