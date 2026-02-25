import React, { useRef, useCallback } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import Terminal, { type TerminalRef } from './Terminal';
import TerminalTabBar from './TerminalTabBar';
import SftpDualPane from '../Sftp/SftpDualPane';
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
    onSessionId: (tabId: string, sshSessionId: string) => void;
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
    onSessionId,
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

    // ── We must render ALL tabs inside the DOM and hide inactive ones
    // ── so that their SSH connections (which depend on component mount) are not dropped.

    return (
        <div className="flex flex-col h-full w-full overflow-hidden">
            <TerminalTabBar
                tabs={mainTabs}
                activeTabId={activeTabId}
                onSelect={onSelectTab}
                onClose={onCloseTab}
            />

            <Group
                orientation={orientation}
                className="flex-1 overflow-hidden relative"
                onLayoutChange={handleLayout}
            >
                <Panel defaultSize={splitTab && splitMode !== 'none' ? 50 : 100} minSize={20} className="relative bg-[#0f172a]">
                    {mainTabs.map(tab => {
                        const isActive = tab.id === activeTabId;
                        return (
                            <div
                                key={tab.id}
                                className={`absolute inset-0 flex flex-col ${isActive ? 'z-10 opacity-100 pointer-events-auto' : 'z-0 opacity-0 pointer-events-none'}`}
                            >
                                {tab.type === 'terminal' ? (
                                    <Terminal
                                        ref={isActive ? mainTermRef : undefined}
                                        server={tab.server}
                                        onClose={() => onCloseTab(tab.id)}
                                        themeId={themeId}
                                        onSessionId={(sid) => onSessionId(tab.id, sid)}
                                    />
                                ) : (
                                    <div className="flex-1 overflow-hidden">
                                        <SftpDualPane server={tab.server} />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </Panel>

                {splitTab && splitMode !== 'none' && (
                    <>
                        <Separator
                            className={`
                                ${orientation === 'horizontal' ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'}
                                bg-slate-800 hover:bg-sky-600 transition-colors shrink-0
                            `}
                        />
                        <Panel defaultSize={50} minSize={20} className="relative bg-[#0f172a]">
                            <div className="absolute inset-0 flex flex-col z-10">
                                {splitTab.type === 'terminal' ? (
                                    <Terminal
                                        ref={splitTermRef}
                                        server={splitTab.server}
                                        onClose={onCloseSplit}
                                        themeId={themeId}
                                        onSessionId={(sid) => onSessionId(splitTab.id, sid)}
                                    />
                                ) : (
                                    <div className="flex-1 overflow-hidden">
                                        <SftpDualPane server={splitTab.server} />
                                    </div>
                                )}
                            </div>
                        </Panel>
                    </>
                )}
            </Group>
        </div>
    );
};

export default TerminalWorkspace;
