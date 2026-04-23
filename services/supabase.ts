/**
 * Клиент Supabase для мобильного приложения.
 *
 * Хранилище сессии: на **iOS/Android** — `expo-secure-store` (Keychain / Keystore).
 * На **web** (в т.ч. если случайно открыли `http://…:8081` в Safari) —
 * `localStorage`, иначе `expo-secure-store` не инициализируется и падает
 * `getValueWithKeyAsync is not a function`.
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
  const SecureStore = require("expo-secure-store") as typeof import("expo-secure-store");
  return {
    getItem: (key: string) => SecureStore.getItemAsync(key),
    setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
    removeItem: (key: string) => SecureStore.deleteItemAsync(key),
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
