import { invoke } from "@tauri-apps/api/core";

export interface AppUpdateInfo {
  current_version: string;
  latest_version: string | null;
  update_available: boolean;
  release_url: string;
}

export const checkAppUpdate = (): Promise<AppUpdateInfo> =>
  invoke<AppUpdateInfo>("check_app_update");
