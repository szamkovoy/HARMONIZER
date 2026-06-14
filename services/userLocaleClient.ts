import type { AppLocale } from "@/modules/i18n/localeStore";
import { asContentLocale } from "@/modules/i18n/localeCodes";
import { requireSupabase } from "@/services/supabase";

/**
 * Mirror the in-app language selector to `users.locale` so server-side
 * resolveContentLocale can fall back to the profile when the client omits
 * responseLocale.
 */
export async function syncUserLocaleToServer(locale: AppLocale): Promise<void> {
  const normalized = asContentLocale(locale);
  if (!normalized) return;

  const supabase = requireSupabase();
  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const userId = data.session?.user?.id;
  if (!userId) return;

  const { error } = await supabase.from("users").update({ locale: normalized }).eq("id", userId);
  if (error) throw error;
}
