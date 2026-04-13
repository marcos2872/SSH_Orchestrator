import { invoke } from "@tauri-apps/api/core";

export interface GitHubUser {
  login: string;
  name: string;
  avatar_url: string;
  email: string | null;
  html_url: string;
}

export interface AuthResponse {
  user: GitHubUser;
}

export const githubLogin = (): Promise<AuthResponse> =>
  invoke<AuthResponse>("github_login");

export const getCurrentUser = (): Promise<AuthResponse | null> =>
  invoke<AuthResponse | null>("get_current_user");

export const githubLogout = (): Promise<void> =>
  invoke<void>("github_logout");
