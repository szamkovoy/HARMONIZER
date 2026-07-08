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
  const { error } = await supabase.from("user_event_log").insert({
    user_id: userId,
    kind: "app_open",
    payload: {},
  });
  if (error) {
    lastLoggedAt = 0;
    console.warn("[metrics] app_open log failed", error.message);
  }
}
