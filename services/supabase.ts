/**
 * Клиент Supabase для мобильного приложения.
 *
 * Хранилище сессии — `expo-secure-store`, чтобы access/refresh токены лежали в
 * iOS Keychain / Android Keystore, а не в AsyncStorage (который можно прочитать
 * из рутованного устройства).
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
import * as SecureStore from "expo-secure-store";
import type { Database } from "./supabase-types";

const EXPO_SB_URL = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const EXPO_SB_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

/**
 * Адаптер expo-secure-store к ожидаемому supabase-js storage API
 * (setItem/getItem/removeItem).
 *
 * SecureStore имеет лимит ~2 KB на запись — обычно токенов это хватает с
 * запасом, но Supabase при желании может писать больше. Если столкнёмся с
 * "Value too large" — добавим fallback на AsyncStorage только для крупных
 * полей. Пока держим просто.
 */
const secureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

function createSupabaseClient(): SupabaseClient<Database> | null {
  if (!EXPO_SB_URL || !EXPO_SB_KEY) {
    return null;
  }
  return createClient<Database>(EXPO_SB_URL, EXPO_SB_KEY, {
    auth: {
      storage: secureStoreAdapter,
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
