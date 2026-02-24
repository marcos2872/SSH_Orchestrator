import { useState, useCallback } from 'react';

export interface Server {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    has_saved_password: boolean;
}

export type SplitMode = 'none' | 'horizontal' | 'vertical';

export interface Tab {
    id: string;
    server: Server;
    type: 'terminal' | 'sftp';
    /** UUID retornado pelo backend ao conectar via SSH (necessário para SFTP via terminal) */
    sshSessionId: string | null;
}

let _tabCounter = 0;

export function useTerminalManager() {
    const [tabs, setTabs] = useState<Tab[]>([]);
    const [activeTabId, setActiveTabId] = useState<string | null>(null);
    const [splitTabId, setSplitTabId] = useState<string | null>(null);
    const [splitMode, setSplitMode] = useState<SplitMode>('none');

    const openTab = useCallback((server: Server) => {
        const id = `tab-${++_tabCounter}`;
        const newTab: Tab = { id, server, type: 'terminal', sshSessionId: null };
        setTabs(prev => [...prev, newTab]);
        setActiveTabId(id);
        return id;
    }, []);

    const openSftpTab = useCallback((server: Server) => {
        const id = `tab-${++_tabCounter}`;
        const newTab: Tab = { id, server, type: 'sftp', sshSessionId: null };
        setTabs(prev => [...prev, newTab]);
        setActiveTabId(id);
        return id;
    }, []);

    /** Atualiza o SSH session ID de uma aba após a conexão ser estabelecida pelo Terminal */
    const updateSshSessionId = useCallback((tabId: string, sshSessionId: string) => {
        setTabs(prev => prev.map(t => t.id === tabId ? { ...t, sshSessionId } : t));
    }, []);

    const closeTab = useCallback((tabId: string) => {
        setTabs(prev => {
            const next = prev.filter(t => t.id !== tabId);
            return next;
        });
        setActiveTabId(prev => {
            if (prev !== tabId) return prev;
            const idx = tabs.findIndex(t => t.id === tabId);
            const remaining = tabs.filter(t => t.id !== tabId);
            if (remaining.length === 0) return null;
            return remaining[Math.min(idx, remaining.length - 1)]?.id ?? null;
        });
        setSplitTabId(prev => prev === tabId ? null : prev);
        setSplitMode(prev => {
            if (splitTabId === tabId) return 'none';
            return prev;
        });
    }, [tabs, splitTabId]);

    const splitPane = useCallback((direction: SplitMode, server: Server) => {
        const id = `tab-${++_tabCounter}`;
        const newTab: Tab = { id, server, type: 'terminal', sshSessionId: null };
        setTabs(prev => [...prev, newTab]);
        setSplitTabId(id);
        setSplitMode(direction);
    }, []);

    const closeSplit = useCallback(() => {
        if (splitTabId) {
            setTabs(prev => prev.filter(t => t.id !== splitTabId));
        }
        setSplitTabId(null);
        setSplitMode('none');
    }, [splitTabId]);

    const closeAll = useCallback(() => {
        setTabs([]);
        setActiveTabId(null);
        setSplitTabId(null);
        setSplitMode('none');
    }, []);

    return {
        tabs,
        activeTabId,
        splitTabId,
        splitMode,
        openTab,
        openSftpTab,
        closeTab,
        splitPane,
        closeSplit,
        closeAll,
        updateSshSessionId,
        setActiveTabId,
        // Derived
        activeTab: tabs.find(t => t.id === activeTabId) ?? null,
        splitTab: tabs.find(t => t.id === splitTabId) ?? null,
        hasTabs: tabs.length > 0,
    };
}
