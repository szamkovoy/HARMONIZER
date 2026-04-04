import { createClient, SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null | undefined;

/**
 * Клиент Supabase для мобильного клиента (те же переменные, что и в вебе, с префиксом EXPO_PUBLIC_).
 * Логика из `_legacy_web/lib/supabase.ts`, без падения при отсутствии ключей (модуль может не использоваться).
 */
export function getSupabase(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) {
    cached = null;
    return null;
  }
  cached = createClient(url, anonKey);
  return cached;
}
