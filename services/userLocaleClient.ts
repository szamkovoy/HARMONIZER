import type { AppLocale } from "@/modules/i18n/localeStore";
import { asContentLocale } from "@/modules/i18n/localeCodes";
import { getSupabaseAccessSession, requireSupabase } from "@/services/supabase";

/**
 * Mirror the in-app language selector to `users.locale` so server-side
 * resolveContentLocale can fall back to the profile when the client omits
 * responseLocale.
 *
 * Callers mirror "always" on purpose (covers "UI already Italian, DB still
 * Russian"), but a PATCH on every foreground return also echoes back through
 * the Realtime `users` subscription as a full profile refetch. So the write is
 * memoised per (user, locale) for this JS process; `force` bypasses it when the
 * caller has evidence the server value differs (localeStore hydrate).
 */
let lastSyncedKey: string | null = null;

/** Sign-out / account switch or tests: forget what was mirrored. */
export function resetUserLocaleSyncMemo(): void {
  lastSyncedKey = null;
}

/** The profile row already carries this locale — no write needed for it. */
export function markUserLocaleSynced(userId: string, locale: AppLocale): void {
  const normalized = asContentLocale(locale);
  if (!normalized) return;
  lastSyncedKey = `${userId}:${normalized}`;
}

export async function syncUserLocaleToServer(
  locale: AppLocale,
  opts?: { force?: boolean },
): Promise<void> {
  const normalized = asContentLocale(locale);
  if (!normalized) return;

  const session = await getSupabaseAccessSession();
  const userId = session.user?.id;
  if (!userId) return;

  const key = `${userId}:${normalized}`;
  if (!opts?.force && lastSyncedKey === key) return;

  const supabase = requireSupabase();
  const { error } = await supabase.from("users").update({ locale: normalized }).eq("id", userId);
  if (error) throw error;
  lastSyncedKey = key;
}
