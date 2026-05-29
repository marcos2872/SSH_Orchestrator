const STORAGE_KEY = 'server_rdp_prefs';

function getAll(): Record<string, boolean> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

/** Retorna se RDP está habilitado para o servidor. Default: true */
export function isRdpEnabled(serverId: string): boolean {
    const prefs = getAll();
    return prefs[serverId] !== false;
}

/** Define se RDP está habilitado para o servidor */
export function setRdpEnabled(serverId: string, enabled: boolean): void {
    const prefs = getAll();
    prefs[serverId] = enabled;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}
