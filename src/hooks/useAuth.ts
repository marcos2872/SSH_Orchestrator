/**
 * useAuth — gerencia o estado de autenticação GitHub OAuth.
 * As chamadas IPC estão centralizadas em lib/api/auth.ts.
 */

import { useState, useEffect } from "react";
import { githubLogin, getCurrentUser, githubLogout } from "../lib/api/auth";
import type { GitHubUser } from "../lib/api/auth";

export type { GitHubUser };

interface AuthState {
  user: GitHubUser | null;
  isLoading: boolean;
}

export function useAuth() {
  const [auth, setAuth] = useState<AuthState>({ user: null, isLoading: true });

  const fetchUser = () => {
    getCurrentUser()
      .then((res) => {
        if (res) {
          setAuth({ user: res.user, isLoading: false });
          window.dispatchEvent(new Event("workspaces-updated"));
        } else {
          setAuth({ user: null, isLoading: false });
        }
      })
      .catch(() => {
        setAuth({ user: null, isLoading: false });
      });
  };

  useEffect(() => {
    fetchUser();

    const handleAuthChanged = () => fetchUser();
    window.addEventListener("auth-changed", handleAuthChanged);
    return () => window.removeEventListener("auth-changed", handleAuthChanged);
  }, []);

  const login = async () => {
    setAuth((s) => ({ ...s, isLoading: true }));
    try {
      const response = await githubLogin();
      setAuth({ isLoading: false, user: response.user });
      window.dispatchEvent(new Event("auth-changed"));
      window.dispatchEvent(new Event("workspaces-updated"));
    } catch {
      setAuth({ user: null, isLoading: false });
      throw new Error("Falha na autenticação com o GitHub.");
    }
  };

  const logout = async () => {
    setAuth((s) => ({ ...s, isLoading: true }));
    try {
      await githubLogout();
      window.dispatchEvent(new Event("auth-changed"));
    } finally {
      setAuth({ user: null, isLoading: false });
    }
  };

  return { user: auth.user, isLoading: auth.isLoading, login, logout };
}
