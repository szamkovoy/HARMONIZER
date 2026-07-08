import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/**
 * Браузерный Supabase-клиент админки (anon key, сессия в localStorage).
 * Используется ТОЛЬКО для аутентификации; данные админка получает через
 * /api/admin/* (service role на сервере), а не прямыми запросами к БД.
 */
export function getBrowserSupabase(): SupabaseClient {
  if (!client) {
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
