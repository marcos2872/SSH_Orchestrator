import { invoke } from "@tauri-apps/api/core";

/** Lê uma preferência pelo nome da chave. Retorna `null` se não existir. */
export async function getSetting(key: string): Promise<string | null> {
  return invoke<string | null>("get_setting", { key });
}

/** Cria ou atualiza uma preferência (upsert). */
export async function setSetting(key: string, value: string): Promise<void> {
  return invoke<void>("set_setting", { key, value });
}
