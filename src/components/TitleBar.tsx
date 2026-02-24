import React, { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

const appWindow = getCurrentWindow();

const TitleBar: React.FC = () => {
    const [isMaximized, setIsMaximized] = useState(false);

    useEffect(() => {
        // Atualiza o estado inicial
        appWindow.isMaximized().then(setIsMaximized);

        // Escuta mudança de tamanho para atualizar ícone maximize/restore
        const unlisten = appWindow.onResized(async () => {
            setIsMaximized(await appWindow.isMaximized());
        });

        return () => {
            unlisten.then((fn) => fn());
        };
    }, []);

    const handleMinimize = () => appWindow.minimize();
    const handleMaximize = () =>
        isMaximized ? appWindow.unmaximize() : appWindow.maximize();
    const handleClose = () => appWindow.close();

    return (
        <div
            data-tauri-drag-region
            className="titlebar"
        >
            {/* Lado esquerdo: ícone + nome */}
            <div className="titlebar-left" data-tauri-drag-region>
                <div className="titlebar-icon" data-tauri-drag-region>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="2" y="3" width="20" height="14" rx="2" />
                        <line x1="8" y1="21" x2="16" y2="21" />
                        <line x1="12" y1="17" x2="12" y2="21" />
                    </svg>
                </div>
                <span className="titlebar-title" data-tauri-drag-region>SSH Orchestrator</span>
            </div>

            {/* Lado direito: botões de controle */}
            <div className="titlebar-controls">
                {/* Minimize */}
                <button
                    className="titlebar-btn titlebar-btn-minimize"
                    onClick={handleMinimize}
                    title="Minimizar"
                    aria-label="Minimizar"
                >
                    <svg width="10" height="2" viewBox="0 0 10 2" fill="currentColor">
                        <rect width="10" height="2" rx="1" />
                    </svg>
                </button>

                {/* Maximize / Restore */}
                <button
                    className="titlebar-btn titlebar-btn-maximize"
                    onClick={handleMaximize}
                    title={isMaximized ? 'Restaurar' : 'Maximizar'}
                    aria-label={isMaximized ? 'Restaurar' : 'Maximizar'}
                >
                    {isMaximized ? (
                        // Ícone de restore (dois quadrados sobrepostos)
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <rect x="2" y="0" width="8" height="8" rx="1" />
                            <rect x="0" y="2" width="8" height="8" rx="1" fill="var(--titlebar-bg)" />
                            <rect x="0" y="2" width="8" height="8" rx="1" />
                        </svg>
                    ) : (
                        // Ícone de maximize (quadrado simples)
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <rect x="0.75" y="0.75" width="8.5" height="8.5" rx="1" />
                        </svg>
                    )}
                </button>

                {/* Close */}
                <button
                    className="titlebar-btn titlebar-btn-close"
                    onClick={handleClose}
                    title="Fechar"
                    aria-label="Fechar"
                >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <line x1="1" y1="1" x2="9" y2="9" />
                        <line x1="9" y1="1" x2="1" y2="9" />
                    </svg>
                </button>
            </div>
        </div>
    );
};

export default TitleBar;
