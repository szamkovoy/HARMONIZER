import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

// Должно совпадать с EXPIRY_MARGIN_MS в @supabase/auth-js
// (AUTO_REFRESH_TICK_THRESHOLD * AUTO_REFRESH_TICK_DURATION_MS = 3 * 30_000).
const SESSION_EXPIRY_MARGIN_MS = 90_000;

/**
 * Подчищает из localStorage устаревшую сессию Supabase ДО того, как клиент
 * запустит свой _initialize() → _recoverAndRefresh(). Иначе supabase-js
 * находит сессию с истёкшим access_token, пытается refresh-нуть её с
 * отозванным refresh_token и делает console.error(AuthApiError). В dev
 * Next.js перехватывает console.error и рисует полноэкранный оверлей,
 * который перекрывает админку, хотя приложение само уйдёт на /admin/login.
 Удаление просроченной сессии заранее делает переход на логин тихим.
 */
function pruneExpiredSupabaseSession(): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  try {
    const storage = window.localStorage;
    // Ключ сессии: sb-<project-ref>-auth-token. Сканируем по паттерну,
    // чтобы не зависеть от точного вывода project-ref из URL.
    const keys = Object.keys(storage);
    for (const key of keys) {
      if (!key.endsWith("-auth-token")) continue;
      const raw = storage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { expires_at?: number } | null;
      const expiresAt = parsed?.expires_at;
      if (typeof expiresAt !== "number") continue;
      if (expiresAt * 1000 - Date.now() < SESSION_EXPIRY_MARGIN_MS) {
        storage.removeItem(key);
      }
    }
  } catch {
    // Лучший случай — supabase-js сам почистит сессию через _removeSession.
  }
}

/**
 * Браузерный Supabase-клиент админки (anon key, сессия в localStorage).
 * Используется ТОЛЬКО для аутентификации; данные админка получает через
 * /api/admin/* (service role на сервере), а не прямыми запросами к БД.
 */
export function getBrowserSupabase(): SupabaseClient {
  if (!client) {
    pruneExpiredSupabaseSession();
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      },
    );
  }
  return client;
}
