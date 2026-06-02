import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";

import { loadActiveNatalProfile } from "@legacy/app/api/_utils/astro-db";
import { phaseTimeFor } from "@legacy/app/api/_utils/dialogBranching";
import { chooseTargetChakra, isMatrixReady, sumMatrices, type DenseMatrix } from "@legacy/app/api/_utils/lifeMatrix";
import { effectiveDialogNowLocal } from "@legacy/app/api/_utils/testMode";
import { buildTopPetals, type CalibrationLike, type PetalData } from "@legacy/app/api/_utils/topPetals";
import { expireStalePlannedEvents, loadDuePlannedEvents, loadLastPlanningSummary, type PlannedEventRow } from "@legacy/app/api/communicator/v2/dialog/lifeMatrixPersistence";
import { todayLocalDate } from "@legacy/app/api/communicator/v2/dialog/dialogHelpers";

export type DialogDailyContext = {
  forecast: Record<string, unknown> | null;
  user: {
    display_name?: string | null;
    locale?: string | null;
    address_form?: string | null;
    tz?: string | null;
    membership_tier?: string | null;
    trial_expires_at?: string | null;
    lat?: number | null;
    lon?: number | null;
  };
  nowLocal: DateTime;
  localDate: string;
  phaseTime: "morning" | "day" | "evening";
  dueEvents: PlannedEventRow[];
  lastPlanningAt: string | null;
  top3Planets: PetalData[];
  matrixReady: boolean;
  aggregatedMatrix: DenseMatrix | null;
  targetChakra: {
    chakraNumber: number;
    reason: string;
    explain: string;
  };
};

async function loadUser(db: SupabaseClient, userId: string) {
  const { data, error } = await db
    .from("users")
    .select("display_name,locale,address_form,tz,membership_tier,trial_expires_at,lat,lon")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as DialogDailyContext["user"] | null) ?? {};
}

async function loadForecastForLocalDate(db: SupabaseClient, userId: string, localDate: string): Promise<Record<string, unknown> | null> {
  const exact = await db
    .from("user_daily_forecasts")
    .select("*")
    .eq("user_id", userId)
    .eq("forecast_date", localDate)
    .maybeSingle();
  if (exact.error) throw exact.error;
  if (exact.data) return exact.data as Record<string, unknown>;

  const latest = await db
    .from("user_daily_forecasts")
    .select("*")
    .eq("user_id", userId)
    .order("forecast_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) throw latest.error;
  return (latest.data as Record<string, unknown> | null) ?? null;
}

async function loadCalibration(db: SupabaseClient, userId: string): Promise<CalibrationLike | null> {
  const { data, error } = await db
    .from("user_calibrations")
    .select("version,source,s_calibrated,h_calibrated,delta_from_initial,user_lexicon")
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return (data as CalibrationLike | null) ?? null;
}

async function loadAggregatedMatrix(db: SupabaseClient, userId: string): Promise<{ count: number; matrix: DenseMatrix | null }> {
  const { data, error } = await db
    .from("daily_matrices")
    .select("matrix")
    .eq("user_id", userId)
    .order("local_date", { ascending: false });
  if (error) throw error;
  const matrices = (data ?? [])
    .map((row) => row.matrix)
    .filter((matrix): matrix is DenseMatrix => Array.isArray(matrix));
  return {
    count: matrices.length,
    matrix: matrices.length ? sumMatrices(matrices) : null,
  };
}

function fallbackTop3FromForecast(forecast: Record<string, unknown> | null): PetalData[] {
  const ranked = Array.isArray(forecast?.ranked_planets)
    ? (forecast?.ranked_planets as Array<string>)
    : [];
  return ranked.slice(0, 3).map((planet, index) => ({
    planet: planet as PetalData["planet"],
    chakra_number: [7, 1, 6, 2, 3, 4, 5][index] ?? 7,
    chakra_label: `chakra-${index + 1}`,
    importance: 0,
    strength: 0,
    harmoniousness: 0,
    tone: "ambivalent_strong",
    main_transit: null,
    main_aspect: null,
    main_orb: null,
    main_activation: null,
  }));
}

export async function loadDialogDailyContext(db: SupabaseClient, userId: string, timezoneHint?: string): Promise<DialogDailyContext> {
  const user = await loadUser(db, userId);
  const timezone = user.tz ?? timezoneHint ?? "UTC";
  const nowLocal = DateTime.now().setZone(timezone);
  const dialogNowLocal = effectiveDialogNowLocal(nowLocal);
  const localDate = todayLocalDate(timezone);
  const nowIso = nowLocal.toUTC().toISO() ?? new Date().toISOString();
  const dueNowIso = dialogNowLocal.toUTC().toISO() ?? nowIso;

  await expireStalePlannedEvents(db, userId, nowIso);

  const [forecast, natal, calibration, dueEvents, lastPlanning, aggregated] = await Promise.all([
    loadForecastForLocalDate(db, userId, localDate),
    loadActiveNatalProfile(db, userId),
    loadCalibration(db, userId),
    loadDuePlannedEvents(db, userId, nowIso, dueNowIso),
    loadLastPlanningSummary(db, userId),
    loadAggregatedMatrix(db, userId),
  ]);

  const top3Planets = forecast
    ? buildTopPetals(forecast as never, natal.profile, calibration, 3)
    : fallbackTop3FromForecast(null);
  const matrixReady = isMatrixReady(aggregated.count);
  const fixedTargetChakra = typeof forecast?.day_target_chakra === "number" ? forecast.day_target_chakra : null;
  const fixedTargetReason = typeof forecast?.day_target_reason === "string" ? forecast.day_target_reason : null;

  const targetChakra = fixedTargetChakra != null
    ? {
        chakraNumber: fixedTargetChakra,
        reason: fixedTargetReason ?? "fixed_day_target",
        explain: "Целевая чакра уже была зафиксирована для этого локального дня.",
      }
    : chooseTargetChakra(top3Planets, matrixReady ? aggregated.matrix : null);

  if (fixedTargetChakra == null && typeof forecast?.id === "string") {
    await db
      .from("user_daily_forecasts")
      .update({
        day_target_chakra: targetChakra.chakraNumber,
        day_target_reason: targetChakra.reason,
        day_target_fixed_at: nowIso,
      })
      .eq("id", forecast.id);
    forecast.day_target_chakra = targetChakra.chakraNumber;
    forecast.day_target_reason = targetChakra.reason;
    forecast.day_target_fixed_at = nowIso;
  }

  return {
    forecast,
    user,
    nowLocal,
    localDate,
    phaseTime: phaseTimeFor(nowLocal),
    dueEvents,
    lastPlanningAt: lastPlanning?.generated_at ?? null,
    top3Planets,
    matrixReady,
    aggregatedMatrix: matrixReady ? aggregated.matrix : null,
    targetChakra,
  };
}
