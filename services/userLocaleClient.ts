import type { AppLocale } from "@/modules/i18n/localeStore";
import { asContentLocale } from "@/modules/i18n/localeCodes";
import { getSupabaseAccessSession, requireSupabase } from "@/services/supabase";

/**
 * Mirror the in-app language selector to `users.locale` so server-side
 * resolveContentLocale can fall back to the profile when the client omits
 * responseLocale.
 */
export async function syncUserLocaleToServer(locale: AppLocale): Promise<void> {
  const normalized = asContentLocale(locale);
  if (!normalized) return;

  const session = await getSupabaseAccessSession();
  const userId = session.user?.id;
  if (!userId) return;

  const supabase = requireSupabase();
  const { error } = await supabase.from("users").update({ locale: normalized }).eq("id", userId);
  if (error) throw error;
}
