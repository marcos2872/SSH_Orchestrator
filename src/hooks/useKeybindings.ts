import { useState, useEffect, useCallback } from "react";
import { DEFAULT_KEYBINDINGS } from "../lib/keybindings";
import { getSetting, setSetting } from "../lib/api/settings";
import type { KeyBinding, KeyAction } from "../lib/keybindings";

export type CustomKeybindings = Record<KeyAction, KeyBinding>;

const STORAGE_KEY = "keybindings";

function mergeWithDefaults(raw: string): CustomKeybindings {
  try {
    const parsed = JSON.parse(raw) as Partial<CustomKeybindings>;
    return { ...DEFAULT_KEYBINDINGS, ...parsed };
  } catch {
    return { ...DEFAULT_KEYBINDINGS };
  }
}

async function persist(bindings: CustomKeybindings): Promise<void> {
  await setSetting(STORAGE_KEY, JSON.stringify(bindings));
}

export function useKeybindings() {
  const [bindings, setBindings] = useState<CustomKeybindings>({
    ...DEFAULT_KEYBINDINGS,
  });

  // Carrega bindings salvos no banco na inicialização
  useEffect(() => {
    getSetting(STORAGE_KEY)
      .then((raw) => {
        if (raw) setBindings(mergeWithDefaults(raw));
      })
      .catch(() => {});
  }, []);

  const updateBinding = useCallback(
    async (action: KeyAction, binding: KeyBinding): Promise<void> => {
      const next = { ...bindings, [action]: binding };
      setBindings(next);
      await persist(next).catch(() => {});
    },
    [bindings],
  );

  const resetToDefaults = useCallback(async (): Promise<void> => {
    const defaults = { ...DEFAULT_KEYBINDINGS };
    setBindings(defaults);
    await persist(defaults).catch(() => {});
  }, []);

  return { bindings, updateBinding, resetToDefaults };
}
