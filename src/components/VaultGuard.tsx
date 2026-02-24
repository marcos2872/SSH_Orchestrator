import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Lock, ShieldAlert, KeyRound, Cloud } from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { useAuth } from '../hooks/useAuth';

interface VaultGuardProps {
    children: React.ReactNode;
}

type VaultFlowState = 'loading' | 'welcome' | 'setup' | 'unlock' | 'unlock_synced';

const VaultGuard: React.FC<VaultGuardProps> = ({ children }) => {
    const [flowState, setFlowState] = useState<VaultFlowState>('loading');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const { error, success } = useToast() as any;
    const { login } = useAuth(); // we need login function here for the Welcome screen

    useEffect(() => {
        checkVaultState();
    }, []);

    const checkVaultState = async () => {
        setFlowState('loading');
        try {
            const configured = await invoke<boolean>('is_vault_configured');

            if (configured) {
                const locked = await invoke<boolean>('is_vault_locked');
                if (locked) {
                    setFlowState('unlock');
                } else {
                    // It's unlocked! We can render children
                    setFlowState('loading'); // Just keep it loading for a split second before unmounting
                    return;
                }
            } else {
                // Not configured. Show Welcome screen
                setFlowState('welcome');
            }
        } catch (err) {
            console.error("Failed to check vault state:", err);
            if (error) error('Falha ao conectar com o serviço de segurança.');
            setFlowState('welcome');
        }
    };

    const handleLoginAndCheckSync = async () => {
        setSubmitting(true);
        try {
            await login(); // This triggers auth AND sync on the backend!

            // Check if sync brought a vault with it
            const hasSyncedVault = await invoke<boolean>('check_synced_vault');
            if (hasSyncedVault) {
                if (success) success('Cofre sincronizado encontrado!');
                setFlowState('unlock_synced');
            } else {
                // Logged in but no vault found, proceed to normal setup
                setFlowState('setup');
            }
        } catch (err: any) {
            if (error) error(`Falha no login: ${err}`);
            setFlowState('welcome');
        } finally {
            setSubmitting(false);
        }
    };

    const handleSetup = async (e: React.FormEvent) => {
        e.preventDefault();
        if (password !== confirmPassword) {
            if (error) error('As senhas não coincidem.');
            return;
        }
        if (password.length < 8) {
            if (error) error('A Master Password deve ter pelo menos 8 caracteres.');
            return;
        }

        setSubmitting(true);
        try {
            await invoke('setup_vault', { password });
            if (success) success('Vault configurado com sucesso!');
            // It will now be configured and unlocked
            await checkVaultState();
            // trigger an update just in case UI needs it
            window.dispatchEvent(new Event('vault-unlocked'));
        } catch (err: any) {
            if (error) error(err.toString());
        } finally {
            setSubmitting(false);
        }
    };

    const handleUnlock = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await invoke('unlock_vault', { password });
            if (success) success('Vault destrancado com sucesso!');
            // Now it is unlocked, we can render children by triggering re-check
            await checkVaultState();
            window.dispatchEvent(new Event('vault-unlocked'));
        } catch (err: any) {
            if (error) error('Senha incorreta.');
            setPassword('');
        } finally {
            setSubmitting(false);
        }
    };

    const handleUnlockSynced = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await invoke('import_synced_vault', { password });
            if (success) success('Cofre sincronizado recuperado com sucesso!');
            // Now it is imported and unlocked, trigger re-check
            await checkVaultState();
            window.dispatchEvent(new Event('vault-unlocked'));
        } catch (err: any) {
            if (error) error(err.toString());
            setPassword('');
        } finally {
            setSubmitting(false);
        }
    };

    // --- Render Logic ---

    // 1. Initial Loading or Unlocked state (which triggers unmount of the guard UI)
    const [isFullyUnlocked, setIsFullyUnlocked] = useState(false);

    useEffect(() => {
        // If the checking passed and it's unlocked, this state updates
        invoke<boolean>('is_vault_configured').then(c => {
            if (c) invoke<boolean>('is_vault_locked').then(l => setIsFullyUnlocked(!l));
        });

        const handler = () => setIsFullyUnlocked(true);
        window.addEventListener('vault-unlocked', handler);
        return () => window.removeEventListener('vault-unlocked', handler);
    }, []);

    if (isFullyUnlocked) {
        return <>{children}</>;
    }

    if (flowState === 'loading') {
        return (
            <div className="flex h-screen w-screen items-center justify-center bg-background text-slate-500 z-[9999] absolute inset-0">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    return (
        <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground z-[9999] absolute inset-0">
            <div className="w-full max-w-md p-8 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl relative overflow-hidden">
                {/* Glow effect */}
                <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-primary/50 to-transparent"></div>

                {flowState === 'welcome' && (
                    <div className="text-center">
                        <div className="mx-auto w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mb-6 border border-slate-700/50">
                            <ShieldAlert className="w-8 h-8 text-primary" />
                        </div>
                        <h1 className="text-2xl font-light mb-4">Bem-vindo ao SSH Orchestrator</h1>
                        <p className="text-sm text-slate-400 mb-8">
                            Para garantir a segurança zero-knowledge das suas credenciais, precisamos configurar o seu cofre local (Vault).
                        </p>

                        <div className="space-y-4">
                            <button
                                onClick={handleLoginAndCheckSync}
                                disabled={submitting}
                                className="w-full bg-[#24292e] hover:bg-[#2f363d] text-white py-3 px-4 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-3 border border-[#1b1f23]/10"
                            >
                                {submitting ? (
                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                                ) : (
                                    <>
                                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                                            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                                        </svg>
                                        <span>Fazer Login com GitHub para Sincronizar</span>
                                    </>
                                )}
                            </button>

                            <div className="relative flex items-center py-2">
                                <div className="flex-grow border-t border-slate-800"></div>
                                <span className="flex-shrink-0 mx-4 text-slate-500 text-xs">OU</span>
                                <div className="flex-grow border-t border-slate-800"></div>
                            </div>

                            <button
                                onClick={() => setFlowState('setup')}
                                disabled={submitting}
                                className="w-full bg-slate-800 hover:bg-slate-700 text-white py-3 px-4 rounded-md text-sm font-medium transition-colors"
                            >
                                Usar Apenas Localmente
                            </button>
                        </div>
                    </div>
                )}

                {flowState === 'setup' && (
                    <>
                        <div className="text-center mb-8">
                            <div className="mx-auto w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mb-4 border border-slate-700/50">
                                <ShieldAlert className="w-8 h-8 text-amber-500" />
                            </div>
                            <h2 className="text-xl font-light mb-2">Criar Vault</h2>
                            <p className="text-sm text-slate-400">
                                Crie uma Master Password forte. Se você perder esta senha, será impossível acessar seus servidores.
                            </p>
                        </div>
                        <form onSubmit={handleSetup} className="space-y-4">
                            <div>
                                <label className="block text-xs text-slate-400 font-medium mb-1">Master Password</label>
                                <div className="relative">
                                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full bg-slate-950 border border-slate-800 rounded-md py-2 pl-10 pr-3 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 text-sm transition-all"
                                        placeholder="Mínimo de 8 caracteres"
                                        autoFocus
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 font-medium mb-1">Confirme a Senha</label>
                                <div className="relative">
                                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                    <input
                                        type="password"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        className="w-full bg-slate-950 border border-slate-800 rounded-md py-2 pl-10 pr-3 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 text-sm transition-all"
                                        placeholder="Repita a Master Password"
                                    />
                                </div>
                            </div>
                            <button
                                type="submit"
                                disabled={submitting || !password || !confirmPassword}
                                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-4"
                            >
                                {submitting ? 'Configurando...' : 'Concluir'}
                            </button>
                        </form>
                    </>
                )}

                {flowState === 'unlock' && (
                    <>
                        <div className="text-center mb-8">
                            <div className="mx-auto w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mb-4 border border-slate-700/50">
                                <Lock className="w-8 h-8 text-primary" />
                            </div>
                            <h2 className="text-xl font-light mb-2">Vault Trancado</h2>
                            <p className="text-sm text-slate-400">
                                Digite sua Master Password para acessar suas configurações e servidores.
                            </p>
                        </div>
                        <form onSubmit={handleUnlock} className="space-y-4">
                            <div>
                                <label className="block text-xs text-slate-400 font-medium mb-1">Master Password</label>
                                <div className="relative">
                                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full bg-slate-950 border border-slate-800 rounded-md py-2 pl-10 pr-3 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 text-sm transition-all"
                                        placeholder="Digite sua senha"
                                        autoFocus
                                    />
                                </div>
                            </div>
                            <button
                                type="submit"
                                disabled={submitting || !password}
                                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-4 flex items-center justify-center gap-2"
                            >
                                <Lock className="w-4 h-4" />
                                {submitting ? 'Acessando...' : 'Destrancar Vault'}
                            </button>
                        </form>
                    </>
                )}

                {flowState === 'unlock_synced' && (
                    <>
                        <div className="text-center mb-8">
                            <div className="mx-auto w-16 h-16 bg-blue-900/50 rounded-full flex items-center justify-center mb-4 border border-blue-500/50">
                                <Cloud className="w-8 h-8 text-blue-400" />
                            </div>
                            <h2 className="text-xl font-light mb-2">Cofre Sincronizado</h2>
                            <p className="text-sm text-slate-400">
                                Encontramos um Vault sincronizado no seu repositório. Digite a Master Password original para restaurá-lo.
                            </p>
                        </div>
                        <form onSubmit={handleUnlockSynced} className="space-y-4">
                            <div>
                                <label className="block text-xs text-slate-400 font-medium mb-1">Master Password Original</label>
                                <div className="relative">
                                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full bg-slate-950 border border-slate-800 rounded-md py-2 pl-10 pr-3 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 text-sm transition-all border-blue-500/30"
                                        placeholder="Digite sua senha"
                                        autoFocus
                                    />
                                </div>
                            </div>
                            <button
                                type="submit"
                                disabled={submitting || !password}
                                className="w-full bg-blue-600 hover:bg-blue-500 text-white py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-4 flex items-center justify-center gap-2"
                            >
                                <Lock className="w-4 h-4" />
                                {submitting ? 'Restaurando...' : 'Restaurar e Destrancar'}
                            </button>
                        </form>
                    </>
                )}
            </div>
        </div>
    );
};

export default VaultGuard;
