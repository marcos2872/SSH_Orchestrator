import React from "react";

interface Props {
  size?: string;
  color?: string;
}

// Indicador de carregamento padrão (anel giratório)
const Spinner: React.FC<Props> = ({
  size = "w-4 h-4",
  color = "#0a84ff",
}) => {
  return (
    <div
      className={`${size} rounded-full border-2 animate-spin shrink-0`}
      style={{ borderColor: "rgba(255,255,255,0.1)", borderTopColor: color }}
    />
  );
};

export default Spinner;
