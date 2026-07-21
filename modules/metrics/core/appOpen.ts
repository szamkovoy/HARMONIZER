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
  if (now - lastLoggedAt < MIN_INTERVAL_MS) return;
  lastLoggedAt = now;

  const supabase = getSupabase();
  if (!supabase) return;
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
  // Страна/город — отдельно и не каждый раз: только если пусто или GPS сильно сдвинулся.
  void maybeSyncUserGeoPlace(userId);
}
