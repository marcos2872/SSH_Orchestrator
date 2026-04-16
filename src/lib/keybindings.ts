export interface KeyBinding {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  description: string;
}

/** União de todas as ações configuráveis. */
export type KeyAction =
  | "NEW_TAB"
  | "CLOSE_TAB"
  | "NEXT_TAB"
  | "PREV_TAB"
  | "SPLIT_H"
  | "SPLIT_V"
  | "TOGGLE_SFTP";

/** Mapa de atalhos padrão — usado como fallback quando nenhuma config está salva. */
export const DEFAULT_KEYBINDINGS: Record<KeyAction, KeyBinding> = {
  NEW_TAB:     { key: "t",    ctrl: true,               description: "Nova aba" },
  CLOSE_TAB:   { key: "w",    ctrl: true,               description: "Fechar aba ativa" },
  NEXT_TAB:    { key: "Tab",  ctrl: true,               description: "Próxima aba" },
  PREV_TAB:    { key: "Tab",  ctrl: true, shift: true,  description: "Aba anterior" },
  SPLIT_H:     { key: "\\",  ctrl: true,               description: "Split horizontal" },
  SPLIT_V:     { key: "\\",  ctrl: true, shift: true,  description: "Split vertical" },
  TOGGLE_SFTP: { key: "b",    ctrl: true,               description: "Toggle painel SFTP" },
};

/** Alias para compatibilidade com código existente. */
export const KEYBINDINGS = DEFAULT_KEYBINDINGS;

export function matchesBinding(e: KeyboardEvent, binding: KeyBinding): boolean {
  const ctrl  = binding.ctrl  ?? false;
  const shift = binding.shift ?? false;
  const alt   = binding.alt   ?? false;
  const meta  = binding.meta  ?? false;
  return (
    e.key === binding.key &&
    e.ctrlKey  === ctrl  &&
    e.shiftKey === shift &&
    e.altKey   === alt   &&
    e.metaKey  === meta
  );
}
