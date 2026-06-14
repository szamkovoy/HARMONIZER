import type { SupabaseClient } from "@supabase/supabase-js";

import { ensureGlobalDailyContentRow } from "./ensureGlobalDailyContent";
import { getUserTimezone, todayLocalDate } from "../calibration/extract/forecast-cache-date";

/**
 * Сброс кэшей дня для тестов ИИ (кнопка на главной, POST /api/ai/global-content + devReset).
 * Удаление `global_daily_content` на дату влияет на всех пользователей окружения.
 */
export async function runDevDayContentReset(db: SupabaseClient, userId: string): Promise<{
  forecast_date: string;
  deleted: {
    scenario_cache: number;
    user_daily_forecasts: number;
    global_daily_content: number;
    open_home_conversations: number;
  };
}> {
  const tz = await getUserTimezone(db, userId);
  const localDate = todayLocalDate(tz);

  const { count: scenarioCacheCount, error: scErr } = await db
    .from("scenario_cache")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .eq("scenario_id", "morning_recommendation");
  if (scErr) throw scErr;

  const { count: forecastCount, error: udfErr } = await db
    .from("user_daily_forecasts")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .eq("forecast_date", localDate);
  if (udfErr) throw udfErr;

  const { count: globalContentCount, error: gdcErr } = await db
    .from("global_daily_content")
    .delete({ count: "exact" })
    .eq("forecast_date_utc", localDate);
  if (gdcErr) throw gdcErr;

  const nowIso = new Date().toISOString();
  const { count: conversationCount, error: convErr } = await db
    .from("conversations")
    .update({ ended_at: nowIso }, { count: "exact" })
    .eq("user_id", userId)
    .is("ended_at", null)
    .eq("entry_source", "home");
  if (convErr) throw convErr;

  const { error: giErr } = await db
    .from("scenario_cache")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .eq("scenario_id", "global_content_i18n");
  if (giErr) throw giErr;

  await ensureGlobalDailyContentRow(db, localDate);

  return {
    forecast_date: localDate,
    deleted: {
      scenario_cache: scenarioCacheCount ?? 0,
      user_daily_forecasts: forecastCount ?? 0,
      global_daily_content: globalContentCount ?? 0,
      open_home_conversations: conversationCount ?? 0,
    },
  };
}
