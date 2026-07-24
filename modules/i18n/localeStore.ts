import { Platform } from "react-native";
import { getLocales } from "expo-localization";

import { resolveDeviceAppLocale } from "@/modules/i18n/resolveDeviceAppLocale";
import { syncUserLocaleToServer } from "@/services/userLocaleClient";

/**
 * Single source of truth for the app's active locale (UI + assistant response).
 *
 * - The selected locale drives UI strings AND the `responseLocale` sent to the
 *   dialog/greeting API.
 * - Transcription (STT) language defaults to the selected locale. The voice
 *   pipeline may still choose per-turn auto-detect behavior in Communicator.
 *
 * Persistence reuses the app's expo-secure-store / web-localStorage pattern.
 * See docs/04_workspace/i18n_architecture.md.
 */
export type AppLocale = "ru" | "en" | "de" | "fr" | "it" | "es" | "pt" | "nl";

export interface AppLocaleOption {
  code: AppLocale;
  /** Name of the language in that language (for the picker). */
  nativeLabel: string;
  /** Whether content for this locale is ready (RU/EN now; others after bulk fill). */
  enabled: boolean;
}

/** All target locales. `enabled` flips on once a locale's content is filled in. */
export const APP_LOCALE_OPTIONS: readonly AppLocaleOption[] = [
  { code: "ru", nativeLabel: "Русский", enabled: true },
  { code: "en", nativeLabel: "English", enabled: true },
  { code: "de", nativeLabel: "Deutsch", enabled: true },
  { code: "fr", nativeLabel: "Français", enabled: true },
  { code: "it", nativeLabel: "Italiano", enabled: true },
  { code: "es", nativeLabel: "Español", enabled: true },
  { code: "pt", nativeLabel: "Português", enabled: true },
  { code: "nl", nativeLabel: "Nederlands", enabled: true },
] as const;

export const DEFAULT_APP_LOCALE: AppLocale = "ru";

/**
 * Test mode: allow voice turns to follow the spoken language instead of the
 * selected profile locale. Toggled by env for multilingual QA.
 */
export const I18N_TEST_MODE: boolean = ((): boolean => {
  const raw = (process.env.EXPO_PUBLIC_I18N_TEST_MODE ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
})();

const STORAGE_KEY = "harmonizer.locale.v1";

function isEnabledLocale(value: string | null | undefined): value is AppLocale {
  const code = (value ?? "").trim().slice(0, 2).toLowerCase();
  return APP_LOCALE_OPTIONS.some((opt) => opt.enabled && opt.code === code);
}

/** Reduce any locale-ish string to the nearest ENABLED app locale, else default. */
export function coerceAppLocale(value: string | null | undefined): AppLocale {
  const code = (value ?? "").trim().slice(0, 2).toLowerCase();
  return isEnabledLocale(code) ? (code as AppLocale) : DEFAULT_APP_LOCALE;
}

/**
 * Device language at first launch (no SecureStore / no `users.locale` yet).
 * See `resolveDeviceAppLocale.ts` for the ordered rules (supported → RU-cluster → EN).
 * Returning installs keep SecureStore / profile locale via `hydrateAppLocale`.
 */
function deviceLocaleLanguageCodes(): string[] {
  try {
    const codes: string[] = [];
    for (const loc of getLocales()) {
      const fromCode = (loc.languageCode ?? "").trim().slice(0, 2).toLowerCase();
      const fromTag = (loc.languageTag ?? "").trim().split(/[-_]/)[0]?.toLowerCase() ?? "";
      const code = fromCode || fromTag;
      if (code.length === 2 && !codes.includes(code)) codes.push(code);
    }
    return codes;
  } catch {
    return [];
  }
}

function deviceLocale(): AppLocale {
  return resolveDeviceAppLocale(deviceLocaleLanguageCodes()) as AppLocale;
}

let currentLocale: AppLocale = deviceLocale();
const listeners = new Set<() => void>();

// ---- storage (mirror of services/dayContentCache.ts approach) ----------------
type SecureStoreLike = typeof import("expo-secure-store");

function getSecureStore(): SecureStoreLike | null {
  if (Platform.OS === "web") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-secure-store") as SecureStoreLike;
  } catch {
    return null;
  }
}

function getWebStorage(): Storage | null {
  if (Platform.OS !== "web") return null;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

async function persist(locale: AppLocale): Promise<void> {
  const web = getWebStorage();
  if (web) {
    try {
      web.setItem(STORAGE_KEY, locale);
    } catch {
      /* persistence is best-effort */
    }
    return;
  }
  const secure = getSecureStore();
  if (!secure) return;
  try {
    await secure.setItemAsync(STORAGE_KEY, locale);
  } catch {
    /* persistence is best-effort */
  }
}

async function readPersisted(): Promise<AppLocale | null> {
  const web = getWebStorage();
  if (web) {
    try {
      const raw = web.getItem(STORAGE_KEY);
      return isEnabledLocale(raw) ? (raw as AppLocale) : null;
    } catch {
      return null;
    }
  }
  const secure = getSecureStore();
  if (!secure) return null;
  try {
    const raw = await secure.getItemAsync(STORAGE_KEY);
    return isEnabledLocale(raw) ? (raw as AppLocale) : null;
  } catch {
    return null;
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

let hydrated = false;
/** Last auth user id seen by hydrate — distinguishes account switch vs stale DB locale. */
let hydratedUserId: string | null = null;

/**
 * Resolve the active locale from profile / SecureStore / device.
 *
 * - First hydrate / account switch: `users.locale` wins over sticky SecureStore
 *   from a previous login on the same device.
 * - Same account, profile arrives later with a different locale: keep UI
 *   (SecureStore may already be newer) and write UI → `users.locale` so remote
 *   push matches inbox (stale DB was the Android RU-push / EN-inbox race).
 */
export async function hydrateAppLocale(
  profileLocale?: string | null,
  userId?: string | null,
): Promise<void> {
  const profileCode = isEnabledLocale(profileLocale) ? (profileLocale as AppLocale) : null;
  const nextUserId = userId ?? null;
  const accountChanged = nextUserId !== hydratedUserId;

  if (!hydrated || accountChanged) {
    hydrated = true;
    hydratedUserId = nextUserId;
    const stored = await readPersisted();
    // On account switch / first pass: prefer account locale over device sticky store.
    const next = profileCode ?? stored ?? currentLocale;
    if (next !== currentLocale) {
      currentLocale = next;
      notify();
    }
    if (next !== stored) {
      await persist(next);
    }
    void syncUserLocaleToServer(next).catch(() => undefined);
    return;
  }

  // Same account: do not overwrite UI with a lagging users.locale — re-sync UI → DB.
  if (profileCode && profileCode !== currentLocale) {
    void syncUserLocaleToServer(currentLocale).catch(() => undefined);
  }
}

export function getAppLocale(): AppLocale {
  return currentLocale;
}

export async function setAppLocale(locale: AppLocale): Promise<void> {
  const next = coerceAppLocale(locale);
  if (next === currentLocale) {
    // Still mirror — covers "UI already Italian, DB still Russian".
    void syncUserLocaleToServer(next).catch(() => undefined);
    return;
  }
  currentLocale = next;
  notify();
  await persist(next);
  void syncUserLocaleToServer(next).catch(() => undefined);
}

export function subscribeAppLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Locale the assistant should answer in (sent to the API as `responseLocale`). */
export function getResponseLocale(): AppLocale {
  return currentLocale;
}

/** Default STT/input locale follows the selected app locale. */
export function getTranscribeLocale(): AppLocale {
  return currentLocale;
}
