import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Email живёт в auth.users (public.users его не дублирует) — тянем через
 * Admin API точечно по id, пачками, чтобы не листать весь проект.
 *
 * Prefer row-level buyer_email when available — Auth Admin can 504 under load.
 */
export async function emailsByUserId(
  db: SupabaseClient,
  userIds: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return result;

  // Cap Auth Admin chatter — each getUserById can hang/504 under load.
  const MAX = 40;
  const ids = unique.slice(0, MAX);
  const BATCH = 5;
  const PER_CALL_MS = 4_000;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    const settled = await Promise.all(
      batch.map(async (id) => {
        try {
          const result = await Promise.race([
            db.auth.admin.getUserById(id),
            new Promise<null>((resolve) => {
              setTimeout(() => resolve(null), PER_CALL_MS);
            }),
          ]);
          if (!result || result.error) return { id, email: null };
          return { id, email: result.data.user?.email ?? null };
        } catch {
          return { id, email: null };
        }
      }),
    );
    for (const { id, email } of settled) {
      if (email) result.set(id, email);
    }
  }
  return result;
}
