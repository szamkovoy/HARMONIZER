import "./supabase-auth-console-filter";

/**
 * Клиент Supabase для мобильного приложения.
 *
 * Хранилище сессии: на **iOS/Android** — `expo-secure-store` (Keychain / Keystore).
 * Большая Supabase-сессия дробится на чанки меньше 2048 байт, чтобы текущий
 * dev-client не требовал новых native-модулей.
 * На **web** (в т.ч. если случайно открыли `http://…:8081` в Safari) —
 * `localStorage`, иначе нативные хранилища не инициализируются.
 *
 * Экспортируем один синглтон: импортируйте `supabase` из этого модуля во всём
 * приложении — не создавайте дополнительные клиенты.
 *
 * При отсутствии env-переменных `getSupabase()` (legacy-API) возвращает null —
 * это сохраняет совместимость с местами, где клиент опционален. Но в основном
 * коде используем прямой импорт `supabase` и считаем, что он инициализирован.
 *
 * См. `modules/auth/AuthProvider.tsx` — там подписка на AppState, чтобы
 * автоматически рефрешить токен при возвращении приложения из фона.
 * Для escape hatch при сбое cold-start refresh: `readPersistedAuthSessionFromStorage()`.
 */
import "react-native-url-polyfill/auto";
import { createClient, type Session, SupabaseClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import type { Database } from "./supabase-types";
import { logRuntimeEvent } from "./runtimeDiagnostics";

const EXPO_SB_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const EXPO_SB_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
const ACCESS_TOKEN_EXPIRY_SKEW_MS = 60_000;

function assertExpoPublicSupabaseUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      "EXPO_PUBLIC_SUPABASE_URL задан некорректно (не распознаётся как URL). Ожидается https://<ref>.supabase.co",
    );
  }
  if (parsed.protocol !== "https:") {
    throw new Error("EXPO_PUBLIC_SUPABASE_URL должен начинаться с https://");
  }
  const host = parsed.hostname.trim();
  if (!host || host.includes("<") || host.includes(" ") || host === "your-project.supabase.co") {
    throw new Error(
      "EXPO_PUBLIC_SUPABASE_URL содержит заглушку или пустой хост — проверьте .env.local и перезапустите Metro: npx expo start -c",
    );
  }
}

type SupabaseAuthStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

const SECURE_STORE_CHUNK_SIZE = 1800;
const SECURE_STORE_KEY_RX = /^[A-Za-z0-9._-]+$/;
const AUTH_STORAGE_SLOTS = ["a", "b"] as const;

type SecureStoreLike = typeof import("expo-secure-store");
type AuthStorageSlot = (typeof AUTH_STORAGE_SLOTS)[number];

function safeSecureStoreKey(key: string): string | null {
  const sanitized = key.trim().replace(/[^A-Za-z0-9._-]/g, "_");
  if (!sanitized || !SECURE_STORE_KEY_RX.test(sanitized)) return null;
  return sanitized;
}

function activeSlotKey(key: string): string {
  return `${key}.active`;
}

function slotStorageKey(key: string, slot: AuthStorageSlot): string {
  return `${key}.slot.${slot}`;
}

function isAuthStorageSlot(value: string | null | undefined): value is AuthStorageSlot {
  return value === "a" || value === "b";
}

function chunkCountKey(key: string): string {
  return `${key}.chunks`;
}

function chunkKey(key: string, index: number): string {
  return `${key}.chunk.${index}`;
}

async function readStoredValue(SecureStore: SecureStoreLike, storageKey: string): Promise<string | null> {
  try {
    const countRaw = await SecureStore.getItemAsync(chunkCountKey(storageKey));
    const count = countRaw ? Number(countRaw) : 0;
    if (!Number.isFinite(count) || count <= 0) return SecureStore.getItemAsync(storageKey);

    const chunks = await Promise.all(
      Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(chunkKey(storageKey, index))),
    );
    if (chunks.some((chunk) => chunk == null)) return null;
    return chunks.join("");
  } catch {
    return null;
  }
}

async function clearStoredValue(SecureStore: SecureStoreLike, storageKey: string): Promise<void> {
  try {
    const countRaw = await SecureStore.getItemAsync(chunkCountKey(storageKey));
    const count = countRaw ? Number(countRaw) : 0;
    const chunkKeys = Number.isFinite(count)
      ? Array.from({ length: Math.max(0, count) }, (_, index) => chunkKey(storageKey, index))
      : [];
    await Promise.all([
      SecureStore.deleteItemAsync(storageKey),
      SecureStore.deleteItemAsync(chunkCountKey(storageKey)),
      ...chunkKeys.map((item) => SecureStore.deleteItemAsync(item)),
    ]);
  } catch {
    /* ignore invalid/missing storage keys */
  }
}

async function secureGetChunked(SecureStore: SecureStoreLike, key: string): Promise<string | null> {
  const safeKey = safeSecureStoreKey(key);
  if (!safeKey) return null;

  try {
    const activeSlot = await SecureStore.getItemAsync(activeSlotKey(safeKey));
    if (isAuthStorageSlot(activeSlot)) {
      const activeValue = await readStoredValue(SecureStore, slotStorageKey(safeKey, activeSlot));
      if (activeValue) return activeValue;
      const fallbackSlot = activeSlot === "a" ? "b" : "a";
      const fallbackValue = await readStoredValue(SecureStore, slotStorageKey(safeKey, fallbackSlot));
      if (fallbackValue) return fallbackValue;
    }
  } catch {
    /* ignore slot metadata failures; legacy fallback below */
  }

  return readStoredValue(SecureStore, safeKey);
}

async function writeStoredValue(SecureStore: SecureStoreLike, storageKey: string, value: string): Promise<void> {
  const previousCountRaw = await SecureStore.getItemAsync(chunkCountKey(storageKey));
  const previousCount = previousCountRaw ? Number(previousCountRaw) : 0;

  if (value.length <= SECURE_STORE_CHUNK_SIZE) {
    await SecureStore.setItemAsync(storageKey, value);
    if (Number.isFinite(previousCount) && previousCount > 0) {
      await Promise.all(
        Array.from({ length: previousCount }, (_, index) => SecureStore.deleteItemAsync(chunkKey(storageKey, index))),
      );
      await SecureStore.deleteItemAsync(chunkCountKey(storageKey));
    }
    return;
  }

  const chunks = value.match(new RegExp(`.{1,${SECURE_STORE_CHUNK_SIZE}}`, "g")) ?? [];
  await Promise.all(chunks.map((chunk, index) => SecureStore.setItemAsync(chunkKey(storageKey, index), chunk)));
  await SecureStore.setItemAsync(chunkCountKey(storageKey), String(chunks.length));
  await SecureStore.deleteItemAsync(storageKey);
  if (Number.isFinite(previousCount) && previousCount > chunks.length) {
    await Promise.all(
      Array.from({ length: previousCount - chunks.length }, (_, offset) =>
        SecureStore.deleteItemAsync(chunkKey(storageKey, chunks.length + offset)),
      ),
    );
  }
}

async function secureSetChunked(SecureStore: SecureStoreLike, key: string, value: string): Promise<void> {
  const safeKey = safeSecureStoreKey(key);
  if (!safeKey) return;

  try {
    const activeSlotRaw = await SecureStore.getItemAsync(activeSlotKey(safeKey));
    const activeSlot = isAuthStorageSlot(activeSlotRaw) ? activeSlotRaw : null;
    const nextSlot: AuthStorageSlot = activeSlot === "a" ? "b" : "a";
    const nextStorageKey = slotStorageKey(safeKey, nextSlot);

    await writeStoredValue(SecureStore, nextStorageKey, value);
    const readBack = await readStoredValue(SecureStore, nextStorageKey);
    if (readBack !== value) {
      throw new Error("SecureStore read-back mismatch for session write");
    }

    await SecureStore.setItemAsync(activeSlotKey(safeKey), nextSlot);
    await clearStoredValue(SecureStore, safeKey);
    await clearStoredValue(
      SecureStore,
      slotStorageKey(safeKey, nextSlot === "a" ? "b" : "a"),
    );
  } catch (error) {
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn(
        "[supabase-auth] SecureStore session write failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

async function secureRemoveChunked(SecureStore: SecureStoreLike, key: string): Promise<void> {
  const safeKey = safeSecureStoreKey(key);
  if (!safeKey) return;

  try {
    await Promise.all([
      clearStoredValue(SecureStore, safeKey),
      clearStoredValue(SecureStore, slotStorageKey(safeKey, "a")),
      clearStoredValue(SecureStore, slotStorageKey(safeKey, "b")),
      SecureStore.deleteItemAsync(activeSlotKey(safeKey)),
    ]);
  } catch {
    /* ignore invalid/missing storage keys */
  }
}

/**
 * Адаптер под supabase-js `auth.storage`.
 * Не импортируем `expo-secure-store` на верхнем уровне — иначе web-бандл
 * тянет нативный модуль и падает при открытии Metro URL в браузере / Safari.
 */
function createAuthStorageAdapter(): SupabaseAuthStorage {
  if (Platform.OS === "web") {
    return {
      async getItem(key: string) {
        if (typeof localStorage === "undefined") return null;
        try {
          return localStorage.getItem(key);
        } catch {
          return null;
        }
      },
      async setItem(key: string, value: string) {
        if (typeof localStorage === "undefined") return;
        try {
          localStorage.setItem(key, value);
        } catch {
          /* ignore quota / private mode */
        }
      },
      async removeItem(key: string) {
        if (typeof localStorage === "undefined") return;
        try {
          localStorage.removeItem(key);
        } catch {
          /* ignore */
        }
      },
    };
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const SecureStore = require("expo-secure-store") as SecureStoreLike;

  return {
    async getItem(key: string) {
      return secureGetChunked(SecureStore, key);
    },
    async setItem(key: string, value: string) {
      await secureSetChunked(SecureStore, key, value);
    },
    async removeItem(key: string) {
      await secureRemoveChunked(SecureStore, key);
    },
  };
}

const authStorageAdapter = createAuthStorageAdapter();
let lastKnownSession: Session | null = null;

/** Ключ хранения сессии GoTrue — как в `@supabase/supabase-js` (`sb-<ref>-auth-token`). */
export function computeSupabaseAuthStorageKey(supabaseUrl: string): string | null {
  try {
    const trimmed = supabaseUrl.trim();
    if (!trimmed) return null;
    const ref = new URL(trimmed).hostname.split(".")[0];
    if (!ref) return null;
    return `sb-${ref}-auth-token`;
  } catch {
    return null;
  }
}

/**
 * Читает JSON сессии из того же адаптера, что и singleton-клиент, без захвата lock GoTrue.
 * Используется только как escape hatch, когда refresh на старте упал, а в SecureStore сессия ещё есть.
 */
export async function readPersistedAuthSessionFromStorage(): Promise<Session | null> {
  if (!EXPO_SB_URL) return null;
  const key = computeSupabaseAuthStorageKey(EXPO_SB_URL);
  if (!key) return null;
  const raw = await authStorageAdapter.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Partial<Session> & { user?: { id?: unknown } };
    if (typeof candidate.access_token !== "string" || typeof candidate.refresh_token !== "string") {
      return null;
    }
    if (!candidate.user || typeof candidate.user !== "object" || typeof candidate.user.id !== "string") {
      return null;
    }
    return parsed as Session;
  } catch {
    return null;
  }
}

function sessionHasUsableAccessToken(session: Session | null, allowExpired = false): session is Session {
  if (!session?.access_token || !session.user?.id) return false;
  if (allowExpired) return true;
  const expiresAtMs = typeof session.expires_at === "number" ? session.expires_at * 1000 : null;
  return !expiresAtMs || expiresAtMs - Date.now() > ACCESS_TOKEN_EXPIRY_SKEW_MS;
}

export { sessionHasUsableAccessToken };

export function rememberSupabaseSession(session: Session | null): void {
  lastKnownSession = session;
}

/** Удаляет мёртвую сессию из SecureStore и локального состояния SDK без сетевого sign-out. */
export async function clearPersistedAuthSession(): Promise<void> {
  rememberSupabaseSession(null);
  if (!EXPO_SB_URL) return;
  const key = computeSupabaseAuthStorageKey(EXPO_SB_URL);
  if (key) await authStorageAdapter.removeItem(key);
  try {
    const client = getSupabase();
    if (client) {
      await client.auth.signOut({ scope: "local" });
    }
  } catch {
    /* ignore */
  }
}

export async function getSupabaseSessionSnapshot(options?: { allowExpired?: boolean }): Promise<Session | null> {
  const allowExpired = options?.allowExpired === true;
  if (sessionHasUsableAccessToken(lastKnownSession, allowExpired)) {
    return lastKnownSession;
  }
  const disk = await readPersistedAuthSessionFromStorage();
  if (sessionHasUsableAccessToken(disk, allowExpired)) {
    rememberSupabaseSession(disk);
    return disk;
  }
  return null;
}

export async function getSupabaseAccessSession(): Promise<Session> {
  const snapshot = await getSupabaseSessionSnapshot();
  if (snapshot) return snapshot;

  // Snapshot пустой/протухший — упреждающий refresh, иначе запросы с устаревшим
  // JWT получают 401 (кнопка «Личный кабинет» после долгого фона и т.п.).
  const refreshed = await refreshAccessSessionOnce();
  if (refreshed) return refreshed;

  // Refresh не вышел (нет сети / refresh token отозван) — fallback на состояние SDK.
  const { data, error } = await requireSupabase().auth.getSession();
  if (error) throw error;
  rememberSupabaseSession(data.session ?? null);
  if (data.session?.access_token && data.session.user?.id) {
    return data.session;
  }
  throw new Error("Нужна авторизация Supabase.");
}

/**
 * Один refresh за раз — иначе параллельные вызовы сжигают single-use refresh
 * token и SDK эмитит SIGNED_OUT. Возвращает свежую сессию или null, если refresh
 * не удался (транзиентная сеть / refresh token отозван).
 */
let accessSessionRefreshInFlight: Promise<Session | null> | null = null;

async function refreshAccessSessionOnce(): Promise<Session | null> {
  if (accessSessionRefreshInFlight) return accessSessionRefreshInFlight;
  accessSessionRefreshInFlight = (async () => {
    const { data, error } = await requireSupabase().auth.refreshSession();
    if (error || !data.session?.access_token || !data.session.user?.id) return null;
    rememberSupabaseSession(data.session);
    return data.session;
  })()
    .catch(() => null)
    .finally(() => {
      accessSessionRefreshInFlight = null;
    });
  return accessSessionRefreshInFlight;
}

export async function getSupabaseAccessToken(): Promise<string> {
  return (await getSupabaseAccessSession()).access_token;
}

type SupabaseFetchInput = string | URL | Request;

function requestUrl(input: SupabaseFetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== "undefined" && input instanceof Request) return input.url;
  if (typeof input === "object" && input !== null && "url" in input) {
    return String((input as { url: unknown }).url);
  }
  return String(input);
}

function requestMethod(input: SupabaseFetchInput, init?: RequestInit): string {
  if (init?.method) return init.method;
  if (typeof Request !== "undefined" && input instanceof Request) return input.method;
  if (typeof input === "object" && input !== null && "method" in input) {
    return String((input as { method: unknown }).method);
  }
  return "GET";
}

/**
 * Auth token refresh can hang on iOS cold start (Wi-Fi waking, DNS delay, etc.)
 * and block the Supabase SDK's internal session lock, preventing
 * onAuthStateChange from emitting INITIAL_SESSION. Aborting the fetch lets the
 * SDK treat the failure as transient and fall back to the stored session.
 */
const AUTH_FETCH_TIMEOUT_MS = 15_000;

async function loggedSupabaseFetch(
  input: URL | RequestInfo,
  init?: RequestInit,
): Promise<Response> {
  const url = requestUrl(input as SupabaseFetchInput);
  const method = requestMethod(input as SupabaseFetchInput, init);
  const startedAt = Date.now();

  let abortTimer: ReturnType<typeof setTimeout> | undefined;
  if (url.includes("/auth/v1/token") && !init?.signal) {
    const controller = new AbortController();
    abortTimer = setTimeout(() => controller.abort(), AUTH_FETCH_TIMEOUT_MS);
    init = { ...init, signal: controller.signal };
  }

  logRuntimeEvent("supabase:request_start", { method, url }, "debug");
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log("[supabase] fetch", method, url);
  }
  try {
    const response = await fetch(input as RequestInfo, init);
    logRuntimeEvent(
      "supabase:request_end",
      { method, url, status: response.status, durationMs: Date.now() - startedAt },
      response.ok ? "debug" : "warn",
    );
    return response;
  } catch (error) {
    logRuntimeEvent(
      "supabase:request_failed",
      { method, url, durationMs: Date.now() - startedAt, message: error instanceof Error ? error.message : String(error) },
      "warn",
    );
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn("[supabase] fetch failed", method, url, error instanceof Error ? error.message : String(error));
    }
    throw error;
  } finally {
    if (abortTimer !== undefined) clearTimeout(abortTimer);
  }
}

function createSupabaseClient(): SupabaseClient<Database> | null {
  if (!EXPO_SB_URL || !EXPO_SB_KEY) {
    return null;
  }
  assertExpoPublicSupabaseUrl(EXPO_SB_URL);
  return createClient<Database>(EXPO_SB_URL, EXPO_SB_KEY, {
    global: {
      fetch: loggedSupabaseFetch as typeof fetch,
    },
    auth: {
      storage: authStorageAdapter,
      autoRefreshToken: false,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }) as SupabaseClient<Database>;
}

/**
 * Лениво инициализированный синглтон. Если env нет — возвращает null.
 * В приложении в режиме auth мы ожидаем, что он всегда есть, и выбрасываем
 * ошибку на границе модуля auth (см. `modules/auth`).
 */
let cached: SupabaseClient<Database> | null | undefined;

export function getSupabase(): SupabaseClient<Database> | null {
  if (cached === undefined) {
    cached = createSupabaseClient();
  }
  return cached;
}

/**
 * Жёсткая версия: выбросит, если Supabase не сконфигурирован.
 * Используйте везде, где клиент обязателен (AuthProvider, home-запросы, …).
 */
export function requireSupabase(): SupabaseClient<Database> {
  const client = getSupabase();
  if (!client) {
    throw new Error(
      "Supabase is not configured. Check EXPO_PUBLIC_SUPABASE_URL and " +
        "EXPO_PUBLIC_SUPABASE_ANON_KEY in your .env.local.",
    );
  }
  return client;
}
