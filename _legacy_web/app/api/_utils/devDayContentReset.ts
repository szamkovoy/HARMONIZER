import type { SupabaseClient } from "@supabase/supabase-js";

import { ensureGlobalDailyContentRow } from "./ensureGlobalDailyContent";
import { getUserTimezone, todayLocalDate } from "../calibration/extract/forecast-cache-date";

/**
 * Сброс кэшей дня для тестов ИИ (кнопка на главной, POST /api/ai/global-content + devReset).
 * Удаление `global_daily_content` на дату влияет на всех пользователей окружения.
 */
export async function runDevDayContentReset(db: SupabaseClient, userId: string): Promise<{ forecast_date: string }> {
  const tz = await getUserTimezone(db, userId);
  const localDate = todayLocalDate(tz);

  const { error: scErr } = await db.from("scenario_cache").delete().eq("user_id", userId).eq("scenario_id", "morning_recommendation");
  if (scErr) throw scErr;

  const { error: udfErr } = await db.from("user_daily_forecasts").delete().eq("user_id", userId).eq("forecast_date", localDate);
  if (udfErr) throw udfErr;

  const { error: gdcErr } = await db.from("global_daily_content").delete().eq("forecast_date_utc", localDate);
  if (gdcErr) throw gdcErr;

  const nowIso = new Date().toISOString();
  const { error: convErr } = await db
    .from("conversations")
    .update({ ended_at: nowIso })
    .eq("user_id", userId)
    .is("ended_at", null)
    .eq("entry_source", "home");
  if (convErr) throw convErr;

  await ensureGlobalDailyContentRow(db, localDate);

  return { forecast_date: localDate };
}
