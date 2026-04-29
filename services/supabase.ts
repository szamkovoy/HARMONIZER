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
 */
import "react-native-url-polyfill/auto";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import type { Database } from "./supabase-types";

const EXPO_SB_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const EXPO_SB_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

type SupabaseAuthStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

const SECURE_STORE_CHUNK_SIZE = 1800;
const SECURE_STORE_KEY_RX = /^[A-Za-z0-9._-]+$/;

type SecureStoreLike = typeof import("expo-secure-store");

function safeSecureStoreKey(key: string): string | null {
  const sanitized = key.trim().replace(/[^A-Za-z0-9._-]/g, "_");
  if (!sanitized || !SECURE_STORE_KEY_RX.test(sanitized)) return null;
  return sanitized;
}

function chunkCountKey(key: string): string {
  return `${key}.chunks`;
}

function chunkKey(key: string, index: number): string {
  return `${key}.chunk.${index}`;
}

async function secureGetChunked(SecureStore: SecureStoreLike, key: string): Promise<string | null> {
  const safeKey = safeSecureStoreKey(key);
  if (!safeKey) return null;

  try {
    const countRaw = await SecureStore.getItemAsync(chunkCountKey(safeKey));
    const count = countRaw ? Number(countRaw) : 0;
    if (!Number.isFinite(count) || count <= 0) return SecureStore.getItemAsync(safeKey);

    const chunks = await Promise.all(
      Array.from({ length: count }, (_, index) => SecureStore.getItemAsync(chunkKey(safeKey, index))),
    );
    if (chunks.some((chunk) => chunk == null)) return null;
    return chunks.join("");
  } catch {
    return null;
  }
}

async function secureSetChunked(SecureStore: SecureStoreLike, key: string, value: string): Promise<void> {
  const safeKey = safeSecureStoreKey(key);
  if (!safeKey) return;

  try {
    await secureRemoveChunked(SecureStore, safeKey);
    if (value.length <= SECURE_STORE_CHUNK_SIZE) {
      await SecureStore.setItemAsync(safeKey, value);
      return;
    }

    const chunks = value.match(new RegExp(`.{1,${SECURE_STORE_CHUNK_SIZE}}`, "g")) ?? [];
    await Promise.all(chunks.map((chunk, index) => SecureStore.setItemAsync(chunkKey(safeKey, index), chunk)));
    await SecureStore.setItemAsync(chunkCountKey(safeKey), String(chunks.length));
  } catch {
    /* Ignore invalid/quota storage writes; Supabase can recover with a new sign-in. */
  }
}

async function secureRemoveChunked(SecureStore: SecureStoreLike, key: string): Promise<void> {
  const safeKey = safeSecureStoreKey(key);
  if (!safeKey) return;

  try {
    const countRaw = await SecureStore.getItemAsync(chunkCountKey(safeKey));
    const count = countRaw ? Number(countRaw) : 0;
    const chunkKeys = Number.isFinite(count)
      ? Array.from({ length: Math.max(0, count) }, (_, index) => chunkKey(safeKey, index))
      : [];
    await Promise.all([
      SecureStore.deleteItemAsync(safeKey),
      SecureStore.deleteItemAsync(chunkCountKey(safeKey)),
      ...chunkKeys.map((item) => SecureStore.deleteItemAsync(item)),
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

function createSupabaseClient(): SupabaseClient<Database> | null {
  if (!EXPO_SB_URL || !EXPO_SB_KEY) {
    return null;
  }
  return createClient<Database>(EXPO_SB_URL, EXPO_SB_KEY, {
    auth: {
      storage: authStorageAdapter,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
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
