/**
 * useAuth – stub para autenticação GitHub OAuth.
 * Substituir a lógica de login/logout pela integração real com OAuth quando implementado.
 */

import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

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

interface AuthResponse {
    user: GitHubUser;
}

export function useAuth() {
    const [auth, setAuth] = useState<AuthState>({ user: null, isLoading: false });

    const login = async () => {
        setAuth((s) => ({ ...s, isLoading: true }));
        try {
            const response = await invoke<AuthResponse>('github_login');
            setAuth({
                isLoading: false,
                user: response.user,
            });
        } catch (e) {
            console.error('Login failed:', e);
            setAuth({ user: null, isLoading: false });
        }
    };

    const logout = () => {
        setAuth({ user: null, isLoading: false });
        // Em um app completo teríamos também um tauri command para limpar
    };

    return { user: auth.user, isLoading: auth.isLoading, login, logout };
}
