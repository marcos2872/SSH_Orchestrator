import React from "react";

interface Props {
  icon: React.ReactNode;
  children: React.ReactNode;
}

// Cabeçalho de seção das telas de configuração (ícone + título)
const SectionLabel: React.FC<Props> = ({ icon, children }) => {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span
        className="[&>svg]:w-4 [&>svg]:h-4"
        style={{ color: "rgba(255,255,255,0.55)" }}
      >
        {icon}
      </span>
      <span
        className="text-[11px] font-medium"
        style={{ color: "rgba(235,235,245,0.55)" }}
      >
        {children}
      </span>
    </div>
  );
};

export default SectionLabel;
