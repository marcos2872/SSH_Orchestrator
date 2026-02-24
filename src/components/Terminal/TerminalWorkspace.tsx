import React, { useRef, useCallback } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import Terminal, { type TerminalRef } from './Terminal';
import TerminalTabBar from './TerminalTabBar';
import type { Tab, SplitMode } from '../../hooks/useTerminalManager';

interface Props {
    tabs: Tab[];
    activeTabId: string | null;
    splitTab: Tab | null;
    splitMode: SplitMode;
    themeId: string;
    onSelectTab: (tabId: string) => void;
    onCloseTab: (tabId: string) => void;
    onCloseSplit: () => void;
}

const TerminalWorkspace: React.FC<Props> = ({
    tabs,
    activeTabId,
    splitTab,
    splitMode,
    themeId,
    onSelectTab,
    onCloseTab,
    onCloseSplit,
}) => {
    const mainTermRef = useRef<TerminalRef>(null);
    const splitTermRef = useRef<TerminalRef>(null);

    const handleLayout = useCallback(() => {
        setTimeout(() => {
            mainTermRef.current?.fit();
            splitTermRef.current?.fit();
        }, 50);
    }, []);

    const activeTab = tabs.find(t => t.id === activeTabId) ?? null;
    if (!activeTab) return null;

    const orientation = splitMode === 'horizontal' ? 'horizontal' : 'vertical';
    const mainTabs = tabs.filter(t => t.id !== splitTab?.id);

    return (
        <div className="flex flex-col h-full w-full overflow-hidden">
            <TerminalTabBar
                tabs={mainTabs}
                activeTabId={activeTabId}
                onSelect={onSelectTab}
                onClose={onCloseTab}
            />

            {splitTab && splitMode !== 'none' ? (
                <Group
                    orientation={orientation}
                    className="flex-1 overflow-hidden"
                    onLayoutChange={handleLayout}
                >
                    <Panel defaultSize={50} minSize={20}>
                        <Terminal
                            ref={mainTermRef}
                            server={activeTab.server}
                            onClose={() => onCloseTab(activeTab.id)}
                            themeId={themeId}
                        />
                    </Panel>
                    <Separator
                        className={`
              ${orientation === 'horizontal' ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'}
              bg-slate-800 hover:bg-sky-600 transition-colors shrink-0
            `}
                    />
                    <Panel defaultSize={50} minSize={20}>
                        <Terminal
                            ref={splitTermRef}
                            server={splitTab.server}
                            onClose={onCloseSplit}
                            themeId={themeId}
                        />
                    </Panel>
                </Group>
            ) : (
                <div className="flex-1 overflow-hidden">
                    <Terminal
                        ref={mainTermRef}
                        server={activeTab.server}
                        onClose={() => onCloseTab(activeTab.id)}
                        themeId={themeId}
                    />
                </div>
            )}
        </div>
    );
};

export default TerminalWorkspace;
