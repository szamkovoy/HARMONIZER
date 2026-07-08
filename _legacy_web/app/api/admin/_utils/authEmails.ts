import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Email живёт в auth.users (public.users его не дублирует) — тянем через
 * Admin API точечно по id, пачками, чтобы не листать весь проект.
 */
export async function emailsByUserId(
  db: SupabaseClient,
  userIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const BATCH = 20;
  for (let i = 0; i < userIds.length; i += BATCH) {
    const batch = userIds.slice(i, i + BATCH);
    const settled = await Promise.all(
      batch.map(async (id) => {
        const { data, error } = await db.auth.admin.getUserById(id);
        return { id, email: error ? null : (data.user?.email ?? null) };
      }),
    );
    for (const { id, email } of settled) {
      if (email) result.set(id, email);
    }
  }
  return result;
}
