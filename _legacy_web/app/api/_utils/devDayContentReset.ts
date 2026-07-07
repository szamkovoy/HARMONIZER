import type { SupabaseClient } from "@supabase/supabase-js";

import { ensureGlobalDailyContentRow } from "./ensureGlobalDailyContent";
import { getUserTimezone, todayLocalDate } from "../calibration/extract/forecast-cache-date";

/** Which server-side day caches the dev «Обновить» button should invalidate. */
export type DevDayContentResetScope = "global" | "personal" | "both";

export type DevDayContentResetResult = {
  scope: DevDayContentResetScope;
  forecast_date: string;
  deleted: {
    scenario_cache: number;
    user_daily_forecasts: number;
    global_daily_content: number;
    open_home_conversations: number;
  };
};

/**
 * Test-mode reset for Home «Обновить».
 * - `global`: shared free-tier row in `global_daily_content` (+ regen via LLM).
 * - `personal`: per-user forecast + morning monologue cache only (paid/trial path).
 * - `both`: clears everything for this user — free global row AND paid personal caches —
 *   so the next `refresh({ forceRefresh: true })` regenerates the active tier's
 *   recommendation for the current date (global for free, natal for paid).
 */
export async function runDevDayContentReset(
  db: SupabaseClient,
  userId: string,
  scope: DevDayContentResetScope,
): Promise<DevDayContentResetResult> {
  const tz = await getUserTimezone(db, userId);
  const localDate = todayLocalDate(tz);
  const deleted = {
    scenario_cache: 0,
    user_daily_forecasts: 0,
    global_daily_content: 0,
    open_home_conversations: 0,
  };

  const doPersonal = scope === "personal" || scope === "both";
  const doGlobal = scope === "global" || scope === "both";

  if (doPersonal) {
    const { count: scenarioCacheCount, error: scErr } = await db
      .from("scenario_cache")
      .delete({ count: "exact" })
      .eq("user_id", userId)
      .eq("scenario_id", "morning_recommendation");
    if (scErr) throw scErr;
    deleted.scenario_cache = scenarioCacheCount ?? 0;

    const { count: forecastCount, error: udfErr } = await db
      .from("user_daily_forecasts")
      .delete({ count: "exact" })
      .eq("user_id", userId)
      .eq("forecast_date", localDate);
    if (udfErr) throw udfErr;
    deleted.user_daily_forecasts = forecastCount ?? 0;

    const { error: giErr } = await db
      .from("scenario_cache")
      .delete({ count: "exact" })
      .eq("user_id", userId)
      .eq("scenario_id", "global_content_i18n");
    if (giErr) throw giErr;

    const nowIso = new Date().toISOString();
    const { count: conversationCount, error: convErr } = await db
      .from("conversations")
      .update({ ended_at: nowIso }, { count: "exact" })
      .eq("user_id", userId)
      .is("ended_at", null)
      .eq("entry_source", "home");
    if (convErr) throw convErr;
    deleted.open_home_conversations = conversationCount ?? 0;
  }

  if (doGlobal) {
    const { count: globalContentCount, error: gdcErr } = await db
      .from("global_daily_content")
      .delete({ count: "exact" })
      .eq("forecast_date_utc", localDate);
    if (gdcErr) throw gdcErr;
    deleted.global_daily_content = globalContentCount ?? 0;

    await ensureGlobalDailyContentRow(db, localDate);
  }

  return {
    scope,
    forecast_date: localDate,
    deleted,
  };
}
