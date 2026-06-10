import type { SupabaseClient } from "@supabase/supabase-js";
import { DateTime } from "luxon";

import { loadActiveNatalProfile } from "@legacy/app/api/_utils/astro-db";
import { phaseTimeFor } from "@legacy/app/api/_utils/dialogBranching";
import { chooseTargetChakra, isMatrixReady, rowMass, sumMatrices, type DenseMatrix } from "@legacy/app/api/_utils/lifeMatrix";
import { getLifeSpheresBaseline } from "@legacy/app/api/_utils/lifeSpheresBaseline";
import { effectiveDialogNowLocal } from "@legacy/app/api/_utils/testMode";
import { buildTopPetals, type CalibrationLike, type PetalData } from "@legacy/app/api/_utils/topPetals";
import {
  expireStalePlannedEvents,
  loadDuePlannedEvents,
  loadLastPlanningSummary,
  loadPlannedEventsForLocalDate,
  loadPlannedEventsUpToLocalDate,
  purgeHistoricalSummarizedPlannedEvents,
  type PlannedEventRow,
} from "@legacy/app/api/communicator/v2/dialog/lifeMatrixPersistence";
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
  planningSphereLens: string | null;
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

export async function loadForecastForLocalDate(db: SupabaseClient, userId: string, localDate: string): Promise<Record<string, unknown> | null> {
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

async function loadRecentMatrices(db: SupabaseClient, userId: string, limit = 7): Promise<DenseMatrix[]> {
  const { data, error } = await db
    .from("daily_matrices")
    .select("matrix")
    .eq("user_id", userId)
    .order("local_date", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? [])
    .map((row) => row.matrix)
    .filter((matrix): matrix is DenseMatrix => Array.isArray(matrix));
}

function buildPlanningSphereLens(matrices: DenseMatrix[], locale?: string | null): string | null {
  if (!matrices.length) return null;
  const baseline = getLifeSpheresBaseline(locale);
  const weakest = rowMass(sumMatrices(matrices))
    .map((value, index) => ({
      id: index + 1,
      value,
      title: baseline[index]?.title ?? `Сфера ${index + 1}`,
    }))
    .sort((a, b) => a.value - b.value)
    .slice(0, 2);
  if (!weakest.length) return null;
  const titles = weakest.map((item) => item.title).join(", ");
  const windowDays = matrices.length;
  return locale?.startsWith("en")
    ? `Planning lens: over the last ${windowDays} active day(s), the least represented life spheres are ${titles}. If today's plan is still narrow, gently invite one small action from these areas to broaden the user's life pattern.`
    : `Planning lens: за последние ${windowDays} активных дн${windowDays === 1 ? "я" : windowDays < 5 ? "я" : "ей"} слабее всего представлены сферы «${titles}». Если план дня пока узкий, мягко предложи одно небольшое действие из этих областей, чтобы расширить рисунок жизни.`;
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

export async function loadDialogDailyContext(
  db: SupabaseClient,
  userId: string,
  timezoneHint?: string,
  options?: {
    summarizeUpToLocalDate?: string | null;
    summarizeWholeLocalDate?: string | null;
    /** Debug export must read recently summarized rows — do not purge them first. */
    skipPurgeSummarized?: boolean;
  },
): Promise<DialogDailyContext> {
  const user = await loadUser(db, userId);
  const timezone = user.tz ?? timezoneHint ?? "UTC";
  const nowLocal = DateTime.now().setZone(timezone);
  const localDate = todayLocalDate(timezone);
  const nowIso = nowLocal.toUTC().toISO() ?? new Date().toISOString();
  void effectiveDialogNowLocal(nowLocal);

  await expireStalePlannedEvents(db, userId, nowIso);
  if (!options?.skipPurgeSummarized) {
    await purgeHistoricalSummarizedPlannedEvents(db, userId, localDate);
  }

  const [forecast, natal, calibration, dueEventsRaw, lastPlanning, aggregated, recentMatrices] = await Promise.all([
    loadForecastForLocalDate(db, userId, localDate),
    loadActiveNatalProfile(db, userId),
    loadCalibration(db, userId),
    options?.summarizeUpToLocalDate
      ? loadPlannedEventsUpToLocalDate(db, userId, options.summarizeUpToLocalDate)
      : options?.summarizeWholeLocalDate
        ? loadPlannedEventsForLocalDate(db, userId, options.summarizeWholeLocalDate)
        : loadDuePlannedEvents(db, userId, localDate),
    options?.summarizeWholeLocalDate
      || options?.summarizeUpToLocalDate
      ? Promise.resolve(null)
      : loadLastPlanningSummary(db, userId),
    loadAggregatedMatrix(db, userId),
    loadRecentMatrices(db, userId),
  ]);
  const dueEvents = dueEventsRaw;

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
    planningSphereLens: buildPlanningSphereLens(recentMatrices, user.locale),
    targetChakra,
  };
}

/** When summarizing a past local day, align target chakra with that day's forecast. */
export async function resolveSummarizingPromptContext(
  db: SupabaseClient,
  userId: string,
  context: DialogDailyContext,
  workingLocalDate: string,
): Promise<DialogDailyContext> {
  if (!workingLocalDate || workingLocalDate === context.localDate) return context;
  const forecast = await loadForecastForLocalDate(db, userId, workingLocalDate);
  const chakraNumber = typeof forecast?.day_target_chakra === "number"
    ? forecast.day_target_chakra
    : context.targetChakra.chakraNumber;
  return {
    ...context,
    forecast: forecast ?? context.forecast,
    targetChakra: {
      chakraNumber,
      reason: typeof forecast?.day_target_reason === "string"
        ? forecast.day_target_reason
        : "summary_working_day",
      explain: "Целевая чакра подытоживаемого локального дня.",
    },
  };
}
