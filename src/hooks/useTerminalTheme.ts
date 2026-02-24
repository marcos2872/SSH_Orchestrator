import { useState, useCallback } from 'react';
import { THEMES, DEFAULT_THEME_ID, getTheme, type TerminalTheme } from '../lib/themes';

const STORAGE_KEY = 'ssh-terminal-theme';

export function useTerminalTheme() {
    const [themeId, setThemeId] = useState<string>(() => {
        return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_THEME_ID;
    });

    const currentTheme: TerminalTheme = getTheme(themeId);

    const changeTheme = useCallback((id: string) => {
        setThemeId(id);
        localStorage.setItem(STORAGE_KEY, id);
    }, []);

    return {
        themeId,
        currentTheme,
        themes: THEMES,
        changeTheme,
    };
}
