import { maybeSyncUserGeoPlace } from "@/modules/location/syncUserGeoPlace";
import { getSupabase } from "@/services/supabase";

/**
 * Событие app_open в user_event_log — сырьё для DAU/WAU/MAU в админ-дашборде.
 * Пишем не чаще одного раза в 30 минут на процесс, чтобы возвраты из фона
 * не раздували лог.
 */
const MIN_INTERVAL_MS = 30 * 60 * 1000;

let lastLoggedAt = 0;

export async function logAppOpen(userId: string): Promise<void> {
  const now = Date.now();
  const throttled = now - lastLoggedAt < MIN_INTERVAL_MS;
  if (!throttled) {
    lastLoggedAt = now;
    const supabase = getSupabase();
    if (supabase) {
      const nowIso = new Date().toISOString();
      const [{ error: eventError }, { error: seenError }] = await Promise.all([
        supabase.from("user_event_log").insert({
          user_id: userId,
          kind: "app_open",
          payload: {},
        }),
        supabase.from("users").update({ last_seen_at: nowIso }).eq("id", userId),
      ]);
      if (eventError) {
        lastLoggedAt = 0;
        console.warn("[metrics] app_open log failed", eventError.message);
      }
      if (seenError) {
        console.warn("[metrics] last_seen_at update failed", seenError.message);
      }
    }
  }
  // Страна/город — даже при throttle события: координаты часто появляются
  // после первого app_open (онбординг), а sync внутри needsRefresh сам no-op.
  // `country_code` только из GPS (Nominatim); IP сюда не пишем.
  void maybeSyncUserGeoPlace(userId);
}
