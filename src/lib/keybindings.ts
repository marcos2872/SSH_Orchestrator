export interface KeyBinding {
    key: string;
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    description: string;
}

export const KEYBINDINGS = {
    NEW_TAB: { key: 't', ctrl: true, description: 'Nova aba' },
    CLOSE_TAB: { key: 'w', ctrl: true, description: 'Fechar aba ativa' },
    NEXT_TAB: { key: 'Tab', ctrl: true, description: 'Próxima aba' },
    PREV_TAB: { key: 'Tab', ctrl: true, shift: true, description: 'Aba anterior' },
    SPLIT_H: { key: '\\', ctrl: true, description: 'Split horizontal' },
    SPLIT_V: { key: '\\', ctrl: true, shift: true, description: 'Split vertical' },
    TOGGLE_SFTP: { key: 'b', ctrl: true, description: 'Toggle painel SFTP' },
} as const;

export function matchesBinding(e: KeyboardEvent, binding: KeyBinding): boolean {
    const ctrl = binding.ctrl ?? false;
    const shift = binding.shift ?? false;
    const alt = binding.alt ?? false;
    return (
        e.key === binding.key &&
        e.ctrlKey === ctrl &&
        e.shiftKey === shift &&
        e.altKey === alt
    );
}
