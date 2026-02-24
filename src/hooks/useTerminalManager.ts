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
}

let _tabCounter = 0;

export function useTerminalManager() {
    const [tabs, setTabs] = useState<Tab[]>([]);
    const [activeTabId, setActiveTabId] = useState<string | null>(null);
    const [splitTabId, setSplitTabId] = useState<string | null>(null);
    const [splitMode, setSplitMode] = useState<SplitMode>('none');

    const openTab = useCallback((server: Server) => {
        const id = `tab-${++_tabCounter}`;
        const newTab: Tab = { id, server };
        setTabs(prev => [...prev, newTab]);
        setActiveTabId(id);
    }, []);

    const closeTab = useCallback((tabId: string) => {
        setTabs(prev => {
            const next = prev.filter(t => t.id !== tabId);
            return next;
        });
        setActiveTabId(prev => {
            if (prev !== tabId) return prev;
            // find nearest tab
            const idx = tabs.findIndex(t => t.id === tabId);
            const remaining = tabs.filter(t => t.id !== tabId);
            if (remaining.length === 0) return null;
            const newIdx = Math.min(idx, remaining.length - 1);
            return remaining[newIdx]?.id ?? null;
        });
        setSplitTabId(prev => prev === tabId ? null : prev);
        setSplitMode(prev => {
            // if the closed tab was the split pane, reset split
            if (splitTabId === tabId) return 'none';
            return prev;
        });
    }, [tabs, splitTabId]);

    const splitPane = useCallback((direction: SplitMode, server: Server) => {
        const id = `tab-${++_tabCounter}`;
        const newTab: Tab = { id, server };
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
        closeTab,
        splitPane,
        closeSplit,
        closeAll,
        setActiveTabId,
        // Derived
        activeTab: tabs.find(t => t.id === activeTabId) ?? null,
        splitTab: tabs.find(t => t.id === splitTabId) ?? null,
        hasTabs: tabs.length > 0,
    };
}
