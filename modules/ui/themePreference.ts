/**
 * Пользовательская палитра (светлая / тёмная), независимая от system color scheme.
 * Default = light. Персист: SecureStore / localStorage.
 */
import { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";

import type { PaletteScheme } from "@/modules/ui/theme";

type SecureStoreLike = typeof import("expo-secure-store");

const STORAGE_KEY = "harmonizer.ui.palette";
export const DEFAULT_THEME_PREFERENCE: PaletteScheme = "light";

let cachedPreference: PaletteScheme | null = null;
const listeners = new Set<(scheme: PaletteScheme) => void>();

function getSecureStore(): SecureStoreLike | null {
  if (Platform.OS === "web") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-secure-store") as SecureStoreLike;
  } catch {
    return null;
  }
}

function coerceScheme(raw: string | null | undefined): PaletteScheme {
  return raw === "dark" ? "dark" : "light";
}

export function getThemePreferenceSync(): PaletteScheme {
  return cachedPreference ?? DEFAULT_THEME_PREFERENCE;
}

export async function hydrateThemePreference(): Promise<PaletteScheme> {
  if (cachedPreference != null) return cachedPreference;
  const SecureStore = getSecureStore();
  try {
    if (SecureStore) {
      const raw = await SecureStore.getItemAsync(STORAGE_KEY);
      cachedPreference = coerceScheme(raw);
    } else {
      cachedPreference = coerceScheme(globalThis.localStorage?.getItem(STORAGE_KEY));
    }
  } catch {
    cachedPreference = DEFAULT_THEME_PREFERENCE;
  }
  return cachedPreference;
}

/** Start SecureStore read ASAP so cold start often has palette before first paint. */
void hydrateThemePreference();

export async function setThemePreference(scheme: PaletteScheme): Promise<void> {
  cachedPreference = scheme === "dark" ? "dark" : "light";
  const SecureStore = getSecureStore();
  try {
    if (SecureStore) {
      await SecureStore.setItemAsync(STORAGE_KEY, cachedPreference);
    } else {
      globalThis.localStorage?.setItem(STORAGE_KEY, cachedPreference);
    }
  } catch {
    /* persist best-effort */
  }
  for (const listener of listeners) listener(cachedPreference);
}

/** Подписка на смену палитры (RootLayout / Profile). */
export function useThemePreference(): {
  scheme: PaletteScheme;
  ready: boolean;
  setScheme: (scheme: PaletteScheme) => void;
} {
  const [scheme, setSchemeState] = useState<PaletteScheme>(getThemePreferenceSync());
  const [ready, setReady] = useState(cachedPreference != null);

  useEffect(() => {
    let cancelled = false;
    void hydrateThemePreference().then((value) => {
      if (cancelled) return;
      setSchemeState(value);
      setReady(true);
    });
    const onChange = (next: PaletteScheme) => setSchemeState(next);
    listeners.add(onChange);
    return () => {
      cancelled = true;
      listeners.delete(onChange);
    };
  }, []);

  const setScheme = useCallback((next: PaletteScheme) => {
    void setThemePreference(next);
  }, []);

  return { scheme, ready, setScheme };
}
