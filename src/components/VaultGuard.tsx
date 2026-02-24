import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Lock, ShieldAlert, KeyRound } from 'lucide-react';
import { useToast } from '../hooks/useToast';

interface VaultGuardProps {
    children: React.ReactNode;
}

const VaultGuard: React.FC<VaultGuardProps> = ({ children }) => {
    const [loading, setLoading] = useState(true);
    const [isConfigured, setIsConfigured] = useState(false);
    const [isLocked, setIsLocked] = useState(false);

    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const { error, warning: _w, success, info } = useToast() as any; // warning is missing but let's just use error/success

    useEffect(() => {
        checkVaultState();
    }, []);

    const checkVaultState = async () => {
        try {
            const configured = await invoke<boolean>('is_vault_configured');
            setIsConfigured(configured);

            if (configured) {
                const locked = await invoke<boolean>('is_vault_locked');
                setIsLocked(locked);
            }
        } catch (err) {
            console.error("Failed to check vault state:", err);
            if (error) error('Falha ao conectar com o serviço de segurança.');
        } finally {
            setLoading(false);
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
            await checkVaultState();
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
            await checkVaultState();
        } catch (err: any) {
            if (error) error('Senha incorreta.');
            setPassword('');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) {
        return (
            <div className="flex h-screen w-screen items-center justify-center bg-background text-slate-500">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
        );
    }

    // If configured and unlocked, render the children!
    if (isConfigured && !isLocked) {
        return <>{children}</>;
    }

    return (
        <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground z-[9999] absolute inset-0">
            <div className="w-full max-w-md p-8 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl relative overflow-hidden">
                {/* Glow effect */}
                <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-transparent via-primary/50 to-transparent"></div>

                <div className="text-center mb-8">
                    <div className="mx-auto w-16 h-16 bg-slate-800 rounded-full flex items-center justify-center mb-4 border border-slate-700/50">
                        {isConfigured ? (
                            <Lock className="w-8 h-8 text-primary" />
                        ) : (
                            <ShieldAlert className="w-8 h-8 text-amber-500" />
                        )}
                    </div>
                    <h1 className="text-2xl font-light mb-2">
                        {isConfigured ? 'Vault Trancado' : 'Bem-vindo ao SSH Config Sync'}
                    </h1>
                    <p className="text-sm text-slate-400">
                        {isConfigured
                            ? 'Digite sua Master Password para acessar suas configurações.'
                            : 'Para garantir a segurança zero-knowledge, crie uma Master Password. Ela NUNCA sai do seu computador.'}
                    </p>
                </div>

                {!isConfigured ? (
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
                            {submitting ? 'Configurando cofre...' : 'Configurar Vault'}
                        </button>
                    </form>
                ) : (
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
                )}
            </div>
        </div>
    );
};

export default VaultGuard;
