import React, { useEffect, useRef, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useAuth } from '../hooks/useAuth';
import SyncStatus from './sync/SyncStatus';

const appWindow = getCurrentWindow();

/* ─── Ícone do GitHub ────────────────────────────────────────────── */
const GitHubIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
);

/* ─── TitleBar ───────────────────────────────────────────────────── */
interface Props {
    currentWorkspace?: {
        id: string;
        name: string;
        sync_enabled?: boolean;
    } | null;
}

const TitleBar: React.FC<Props> = ({ currentWorkspace }) => {
    const [isMaximized, setIsMaximized] = useState(false);
    const [dropdownOpen, setDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const { user, isLoading, login, logout } = useAuth();

    useEffect(() => {
        appWindow.isMaximized().then(setIsMaximized);
        const unlisten = appWindow.onResized(async () => {
            setIsMaximized(await appWindow.isMaximized());
        });
        return () => { unlisten.then((fn) => fn()); };
    }, []);

    // Fecha dropdown ao clicar fora
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const handleMinimize = () => appWindow.minimize();
    const handleMaximize = () => isMaximized ? appWindow.unmaximize() : appWindow.maximize();
    const handleClose = () => appWindow.close();

    return (
        <div data-tauri-drag-region className="titlebar">

            {/* Esquerda: ícone + nome */}
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

            {/* Centro: área de drag */}
            <div className="titlebar-drag-center" data-tauri-drag-region />

            {/* Direita: perfil + controles */}
            <div className="titlebar-right">

                {/* ── Perfil ── */}
                <div className="titlebar-profile" ref={dropdownRef}>
                    {!user ? (
                        /* Botão de login */
                        <button
                            className="titlebar-login-btn"
                            onClick={login}
                            disabled={isLoading}
                            title="Entrar com GitHub"
                        >
                            {isLoading ? (
                                <span className="titlebar-spinner" />
                            ) : (
                                <GitHubIcon />
                            )}
                            <span>{isLoading ? 'Entrando…' : 'Entrar'}</span>
                        </button>
                    ) : (
                        /* Avatar + dropdown e SyncStatus */
                        <>
                            <SyncStatus state={currentWorkspace?.sync_enabled ? "idle" : "offline"} />
                            <div className="w-px h-6 bg-slate-800 mx-2" />
                            <button
                                className="titlebar-avatar-btn"
                                onClick={() => setDropdownOpen((o) => !o)}
                                title={user.name}
                            >
                                <img
                                    src={user.avatar_url}
                                    alt={user.name}
                                    className="titlebar-avatar"
                                    draggable={false}
                                />
                                <span className="titlebar-username">{user.login}</span>
                                <svg
                                    width="10" height="6" viewBox="0 0 10 6" fill="none"
                                    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                                    className={`titlebar-chevron ${dropdownOpen ? 'open' : ''}`}
                                >
                                    <polyline points="1,1 5,5 9,1" />
                                </svg>
                            </button>

                            {dropdownOpen && (
                                <div className="titlebar-dropdown">
                                    <div className="titlebar-dropdown-header">
                                        <img src={user.avatar_url} alt={user.name} className="titlebar-dropdown-avatar" />
                                        <div>
                                            <p className="titlebar-dropdown-name">{user.name}</p>
                                            <p className="titlebar-dropdown-login">@{user.login}</p>
                                            {user.email && <p className="titlebar-dropdown-email">{user.email}</p>}
                                        </div>
                                    </div>
                                    <div className="titlebar-dropdown-divider" />
                                    <button
                                        className="titlebar-dropdown-item titlebar-dropdown-logout"
                                        onClick={() => { logout(); setDropdownOpen(false); }}
                                    >
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                                            <polyline points="16 17 21 12 16 7" />
                                            <line x1="21" y1="12" x2="9" y2="12" />
                                        </svg>
                                        Sair da conta
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>

                {/* ── Separador ── */}
                <div className="titlebar-separator" />

                {/* ── Controles de janela ── */}
                <div className="titlebar-controls">
                    <button className="titlebar-btn titlebar-btn-minimize" onClick={handleMinimize} title="Minimizar" aria-label="Minimizar">
                        <svg width="10" height="2" viewBox="0 0 10 2" fill="currentColor">
                            <rect width="10" height="2" rx="1" />
                        </svg>
                    </button>

                    <button className="titlebar-btn titlebar-btn-maximize" onClick={handleMaximize} title={isMaximized ? 'Restaurar' : 'Maximizar'} aria-label={isMaximized ? 'Restaurar' : 'Maximizar'}>
                        {isMaximized ? (
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <rect x="2" y="0" width="8" height="8" rx="1" />
                                <rect x="0" y="2" width="8" height="8" rx="1" fill="var(--titlebar-bg)" />
                                <rect x="0" y="2" width="8" height="8" rx="1" />
                            </svg>
                        ) : (
                            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <rect x="0.75" y="0.75" width="8.5" height="8.5" rx="1" />
                            </svg>
                        )}
                    </button>

                    <button className="titlebar-btn titlebar-btn-close" onClick={handleClose} title="Fechar" aria-label="Fechar">
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <line x1="1" y1="1" x2="9" y2="9" />
                            <line x1="9" y1="1" x2="1" y2="9" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default TitleBar;
