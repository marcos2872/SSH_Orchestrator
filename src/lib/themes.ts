import type { ITheme } from 'xterm';

export interface TerminalTheme {
    id: string;
    name: string;
    theme: ITheme;
}

export const THEMES: TerminalTheme[] = [
    {
        id: 'dark-default',
        name: 'Dark Default',
        theme: {
            background: '#0f172a', foreground: '#f8fafc', cursor: '#38bdf8',
            selectionBackground: '#334155',
            black: '#1e293b', brightBlack: '#475569',
            red: '#f87171', brightRed: '#fca5a5',
            green: '#4ade80', brightGreen: '#86efac',
            yellow: '#facc15', brightYellow: '#fde68a',
            blue: '#60a5fa', brightBlue: '#93c5fd',
            magenta: '#c084fc', brightMagenta: '#d8b4fe',
            cyan: '#22d3ee', brightCyan: '#67e8f9',
            white: '#cbd5e1', brightWhite: '#f8fafc',
        },
    },
    {
        id: 'dracula',
        name: 'Dracula',
        theme: {
            background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2',
            selectionBackground: '#44475a',
            black: '#21222c', brightBlack: '#6272a4',
            red: '#ff5555', brightRed: '#ff6e6e',
            green: '#50fa7b', brightGreen: '#69ff94',
            yellow: '#f1fa8c', brightYellow: '#ffffa5',
            blue: '#bd93f9', brightBlue: '#d6acff',
            magenta: '#ff79c6', brightMagenta: '#ff92df',
            cyan: '#8be9fd', brightCyan: '#a4ffff',
            white: '#f8f8f2', brightWhite: '#ffffff',
        },
    },
    {
        id: 'nord',
        name: 'Nord',
        theme: {
            background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9',
            selectionBackground: '#4c566a',
            black: '#3b4252', brightBlack: '#4c566a',
            red: '#bf616a', brightRed: '#bf616a',
            green: '#a3be8c', brightGreen: '#a3be8c',
            yellow: '#ebcb8b', brightYellow: '#ebcb8b',
            blue: '#81a1c1', brightBlue: '#81a1c1',
            magenta: '#b48ead', brightMagenta: '#b48ead',
            cyan: '#88c0d0', brightCyan: '#8fbcbb',
            white: '#e5e9f0', brightWhite: '#eceff4',
        },
    },
    {
        id: 'solarized-dark',
        name: 'Solarized Dark',
        theme: {
            background: '#002b36', foreground: '#839496', cursor: '#839496',
            selectionBackground: '#073642',
            black: '#073642', brightBlack: '#002b36',
            red: '#dc322f', brightRed: '#cb4b16',
            green: '#859900', brightGreen: '#586e75',
            yellow: '#b58900', brightYellow: '#657b83',
            blue: '#268bd2', brightBlue: '#839496',
            magenta: '#d33682', brightMagenta: '#6c71c4',
            cyan: '#2aa198', brightCyan: '#93a1a1',
            white: '#eee8d5', brightWhite: '#fdf6e3',
        },
    },
    {
        id: 'one-dark',
        name: 'One Dark',
        theme: {
            background: '#282c34', foreground: '#abb2bf', cursor: '#528bff',
            selectionBackground: '#3e4451',
            black: '#282c34', brightBlack: '#5c6370',
            red: '#e06c75', brightRed: '#be5046',
            green: '#98c379', brightGreen: '#98c379',
            yellow: '#e5c07b', brightYellow: '#d19a66',
            blue: '#61afef', brightBlue: '#61afef',
            magenta: '#c678dd', brightMagenta: '#c678dd',
            cyan: '#56b6c2', brightCyan: '#56b6c2',
            white: '#abb2bf', brightWhite: '#ffffff',
        },
    },
    {
        id: 'high-contrast',
        name: 'High Contrast',
        theme: {
            background: '#000000', foreground: '#ffffff', cursor: '#ffffff',
            selectionBackground: '#444444',
            black: '#000000', brightBlack: '#555555',
            red: '#ff0000', brightRed: '#ff5555',
            green: '#00ff00', brightGreen: '#55ff55',
            yellow: '#ffff00', brightYellow: '#ffff55',
            blue: '#5555ff', brightBlue: '#aaaaff',
            magenta: '#ff00ff', brightMagenta: '#ff55ff',
            cyan: '#00ffff', brightCyan: '#55ffff',
            white: '#aaaaaa', brightWhite: '#ffffff',
        },
    },
];

export const DEFAULT_THEME_ID = 'dark-default';

export function getTheme(id: string): TerminalTheme {
    return THEMES.find(t => t.id === id) ?? THEMES[0];
}
