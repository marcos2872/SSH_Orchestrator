/**
 * useAuth – stub para autenticação GitHub OAuth.
 * Substituir a lógica de login/logout pela integração real com OAuth quando implementado.
 */

import { useState, useEffect } from 'react';
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
    const [auth, setAuth] = useState<AuthState>({ user: null, isLoading: true });

    const fetchUser = () => {
        invoke<AuthResponse | null>('get_current_user')
            .then(res => {
                if (res) {
                    setAuth({ user: res.user, isLoading: false });
                    window.dispatchEvent(new Event('workspaces-updated'));
                } else {
                    setAuth({ user: null, isLoading: false });
                }
            })
            .catch(err => {
                console.error("Failed to fetch user:", err);
                setAuth({ user: null, isLoading: false });
            });
    };

    useEffect(() => {
        fetchUser();

        const handleAuthChanged = () => {
            fetchUser();
        };

        window.addEventListener('auth-changed', handleAuthChanged);
        return () => window.removeEventListener('auth-changed', handleAuthChanged);
    }, []);

    const login = async () => {
        setAuth((s) => ({ ...s, isLoading: true }));
        try {
            const response = await invoke<AuthResponse>('github_login');
            setAuth({
                isLoading: false,
                user: response.user,
            });
            window.dispatchEvent(new Event('auth-changed'));
            window.dispatchEvent(new Event('workspaces-updated'));
        } catch (e) {
            console.error('Login failed:', e);
            setAuth({ user: null, isLoading: false });
        }
    };

    const logout = async () => {
        setAuth((s) => ({ ...s, isLoading: true }));
        try {
            await invoke('github_logout');
            window.dispatchEvent(new Event('auth-changed'));
        } catch (e) {
            console.error('Logout failed:', e);
        }
        setAuth({ user: null, isLoading: false });
    };

    return { user: auth.user, isLoading: auth.isLoading, login, logout };
}
