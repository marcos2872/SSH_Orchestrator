/**
 * useAuth – stub para autenticação GitHub OAuth.
 * Substituir a lógica de login/logout pela integração real com OAuth quando implementado.
 */

import { useState } from 'react';

export interface GitHubUser {
    login: string;
    name: string;
    avatar_url: string;
    email: string | null;
    html_url: string;
}

interface AuthState {
    user: GitHubUser | null;
    isLoading: boolean;
}

export function useAuth() {
    const [auth, setAuth] = useState<AuthState>({ user: null, isLoading: false });

    // TODO: substituir por chamada real ao backend Tauri para iniciar OAuth flow
    const login = async () => {
        setAuth((s) => ({ ...s, isLoading: true }));
        // Simulação — remover quando OAuth estiver pronto
        await new Promise((r) => setTimeout(r, 800));
        setAuth({
            isLoading: false,
            user: {
                login: 'usuario',
                name: 'Usuário Exemplo',
                avatar_url: 'https://github.com/github.png',
                email: null,
                html_url: 'https://github.com',
            },
        });
    };

    // TODO: revogar token / limpar sessão no backend
    const logout = () => setAuth({ user: null, isLoading: false });

    return { user: auth.user, isLoading: auth.isLoading, login, logout };
}
