import { invoke } from "@tauri-apps/api/core";

export const isVaultConfigured = (): Promise<boolean> =>
  invoke<boolean>("is_vault_configured");

export const isVaultLocked = (): Promise<boolean> =>
  invoke<boolean>("is_vault_locked");

export const setupVault = (password: string): Promise<void> =>
  invoke<void>("setup_vault", { password });

export const unlockVault = (password: string): Promise<void> =>
  invoke<void>("unlock_vault", { password });

export const checkSyncedVault = (): Promise<boolean> =>
  invoke<boolean>("check_synced_vault");

export const importSyncedVault = (password: string): Promise<void> =>
  invoke<void>("import_synced_vault", { password });

export const getVaultLastAccess = (): Promise<string | null> =>
  invoke<string | null>("get_vault_last_access");
