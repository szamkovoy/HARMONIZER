import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { DateTime } from "luxon";

import type { DayHealthMetric, DayHealthMetricComparison } from "@/services/dayHealthContext";

export type NativeHealthProvider = "apple_health" | "google_health";

export type NativeHealthQueryTrace = {
  metric: string;
  method: string;
  ok: boolean;
  parsed: number | null;
  rawPreview: string | null;
  error: string | null;
  durationMs: number;
};

export type NativeHealthCollectionTrace = {
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  localDate: string;
  timeZone: string | null;
  platform: "ios" | "android" | "web" | "unknown";
  provider: NativeHealthProvider;
  providerStatus: "unavailable" | "available" | "permission_denied";
  rangeStartIso: string | null;
  rangeEndIso: string | null;
  permissionPromptAttempted: boolean;
  permissionPromptResult: boolean | null;
  queries: NativeHealthQueryTrace[];
  notes: string[];
};

export type NativeHealthSignals = {
  provider: NativeHealthProvider;
  providerStatus: "unavailable" | "available" | "permission_denied";
  activity: {
    steps: DayHealthMetric;
    activeCalories: DayHealthMetric;
    workoutMinutes: DayHealthMetric;
  };
  sleep: {
    durationMinutes: DayHealthMetric;
    quality: "good" | "fragmented" | "short" | "long" | "unknown";
  };
  collectionTrace: NativeHealthCollectionTrace;
};

type PermissionBackoff = {
  allowed: boolean;
  deniedCount: number;
  lastPromptAt: string | null;
  nextPromptAt: string | null;
};

type DayRange = {
  start: Date;
  end: Date;
};

const PERMISSION_RECORDS = [
  { accessType: "read" as const, recordType: "Steps" as const },
  { accessType: "read" as const, recordType: "ActiveCaloriesBurned" as const },
  { accessType: "read" as const, recordType: "ExerciseSession" as const },
  { accessType: "read" as const, recordType: "SleepSession" as const },
];

const HEALTH_CONNECT_PROVIDER_PACKAGE = "com.google.android.apps.healthdata";
const AVERAGE_DAYS = 30;
/** After an explicit user denial, do not re-prompt for this many days. */
const DENIAL_COOLDOWN_DAYS = 7;

function emptyMetric(): DayHealthMetric {
  return { value: null, average: null, comparison: "unknown" };
}

function emptyTrace(provider: NativeHealthProvider, localDate: string, timeZone?: string | null): NativeHealthCollectionTrace {
  return {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: null,
    localDate,
    timeZone: timeZone ?? null,
    platform: Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "unknown",
    provider,
    providerStatus: "unavailable",
    rangeStartIso: null,
    rangeEndIso: null,
    permissionPromptAttempted: false,
    permissionPromptResult: null,
    queries: [],
    notes: [],
  };
}

export function emptyNativeHealthSignals(
  provider: NativeHealthProvider,
  providerStatus: NativeHealthSignals["providerStatus"],
  localDate = "",
  timeZone?: string | null,
  notes: string[] = [],
): NativeHealthSignals {
  const collectionTrace = emptyTrace(provider, localDate, timeZone);
  collectionTrace.providerStatus = providerStatus;
  collectionTrace.finishedAt = new Date().toISOString();
  collectionTrace.durationMs = 0;
  collectionTrace.notes = notes;
  return {
    provider,
    providerStatus,
    activity: {
      steps: emptyMetric(),
      activeCalories: emptyMetric(),
      workoutMinutes: emptyMetric(),
    },
    sleep: {
      durationMinutes: emptyMetric(),
      quality: "unknown",
    },
    collectionTrace,
  };
}

function localDayRange(localDate: string, timeZone?: string | null): DayRange {
  const zone =
    (typeof timeZone === "string" && timeZone.trim()) ||
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    "UTC";
  try {
    const start = DateTime.fromISO(localDate, { zone }).startOf("day");
    if (start.isValid) {
      return { start: start.toJSDate(), end: start.plus({ days: 1 }).toJSDate() };
    }
  } catch {
    /* fall through */
  }
  const [year, month, day] = localDate.split("-").map((part) => Number(part));
  const start = new Date(year, (month || 1) - 1, day || 1, 0, 0, 0, 0);
  const end = new Date(year, (month || 1) - 1, (day || 1) + 1, 0, 0, 0, 0);
  return { start, end };
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function minutesBetween(start: Date | string, end: Date | string): number {
  const startMs = typeof start === "string" ? new Date(start).getTime() : start.getTime();
  const endMs = typeof end === "string" ? new Date(end).getTime() : end.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  return (endMs - startMs) / 60000;
}

function compare(value: number | null, average: number | null, toleranceRatio = 0.15): DayHealthMetricComparison {
  if (value == null || average == null || average <= 0) return "unknown";
  const deltaRatio = (value - average) / average;
  if (Math.abs(deltaRatio) <= toleranceRatio) return "similar";
  return deltaRatio > 0 ? "higher" : "lower";
}

function metric(value: number | null, average: number | null): DayHealthMetric {
  return {
    value: value == null ? null : Math.round(value),
    average: average == null ? null : Math.round(average),
    comparison: compare(value, average),
  };
}

function sleepQuality(durationMinutes: number | null): NativeHealthSignals["sleep"]["quality"] {
  if (durationMinutes == null || durationMinutes <= 0) return "unknown";
  if (durationMinutes < 360) return "short";
  if (durationMinutes > 570) return "long";
  return "good";
}

function backoffKey(provider: NativeHealthProvider): string {
  return `harmonizer.health.${provider}.permissionBackoff.v1`;
}

async function readBackoff(provider: NativeHealthProvider): Promise<PermissionBackoff> {
  try {
    const raw = await SecureStore.getItemAsync(backoffKey(provider));
    if (!raw) return { allowed: false, deniedCount: 0, lastPromptAt: null, nextPromptAt: null };
    const parsed = JSON.parse(raw) as Partial<PermissionBackoff>;
    return {
      allowed: parsed.allowed === true,
      deniedCount: Number.isFinite(Number(parsed.deniedCount)) ? Number(parsed.deniedCount) : 0,
      lastPromptAt: typeof parsed.lastPromptAt === "string" ? parsed.lastPromptAt : null,
      nextPromptAt: typeof parsed.nextPromptAt === "string" ? parsed.nextPromptAt : null,
    };
  } catch {
    return { allowed: false, deniedCount: 0, lastPromptAt: null, nextPromptAt: null };
  }
}

async function writeBackoff(provider: NativeHealthProvider, value: PermissionBackoff) {
  await SecureStore.setItemAsync(backoffKey(provider), JSON.stringify(value));
}

/** True when SecureStore has an explicit denial still inside the cooldown window. */
function isDenialCooldownActive(value: PermissionBackoff, now = new Date()): boolean {
  if (value.allowed) return false;
  if (!value.nextPromptAt) return false;
  return new Date(value.nextPromptAt).getTime() > now.getTime();
}

async function recordPermissionResult(provider: NativeHealthProvider, allowed: boolean) {
  const current = await readBackoff(provider);
  const now = new Date();
  if (allowed) {
    await writeBackoff(provider, {
      allowed: true,
      deniedCount: current.deniedCount,
      lastPromptAt: now.toISOString(),
      nextPromptAt: null,
    });
    return;
  }
  const deniedCount = current.deniedCount + 1;
  await writeBackoff(provider, {
    allowed: false,
    deniedCount,
    lastPromptAt: now.toISOString(),
    nextPromptAt: addDays(now, DENIAL_COOLDOWN_DAYS).toISOString(),
  });
}

function previewRaw(value: unknown, max = 240): string | null {
  if (value == null) return null;
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (!text) return null;
    return text.length > max ? `${text.slice(0, max)}…` : text;
  } catch {
    return String(value).slice(0, max);
  }
}

/** Accept both `{ quantity: number }` and bare number (API variants). */
function extractQuantityNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "quantity" in value) {
    const quantity = Number((value as { quantity?: unknown }).quantity);
    return Number.isFinite(quantity) ? quantity : null;
  }
  return null;
}

function finishTrace(trace: NativeHealthCollectionTrace, status: NativeHealthSignals["providerStatus"]) {
  const finishedAt = new Date();
  trace.finishedAt = finishedAt.toISOString();
  trace.durationMs = Math.max(0, finishedAt.getTime() - new Date(trace.startedAt).getTime());
  trace.providerStatus = status;
}

async function collectAppleHealth(localDate: string, timeZone?: string | null): Promise<NativeHealthSignals> {
  const trace = emptyTrace("apple_health", localDate, timeZone);
  if (Platform.OS !== "ios") {
    finishTrace(trace, "unavailable");
    trace.notes.push("not_ios");
    return { ...emptyNativeHealthSignals("apple_health", "unavailable", localDate, timeZone), collectionTrace: trace };
  }
  const healthkit = await import("@kingstinct/react-native-healthkit");
  if (!(await healthkit.isHealthDataAvailableAsync())) {
    finishTrace(trace, "unavailable");
    trace.notes.push("health_data_unavailable");
    return { ...emptyNativeHealthSignals("apple_health", "unavailable", localDate, timeZone), collectionTrace: trace };
  }
  const toRead = [
    "HKQuantityTypeIdentifierStepCount",
    "HKQuantityTypeIdentifierActiveEnergyBurned",
    "HKQuantityTypeIdentifierAppleExerciseTime",
    "HKCategoryTypeIdentifierSleepAnalysis",
    "HKWorkoutTypeIdentifier",
  ] as const;

  const backoff = await readBackoff("apple_health");
  // Explicit user denial within cooldown → do not call auth or query at all.
  if (isDenialCooldownActive(backoff)) {
    finishTrace(trace, "permission_denied");
    trace.notes.push(
      `denial_cooldown_active_until:${backoff.nextPromptAt}`,
      `deniedCount:${backoff.deniedCount}`,
    );
    return {
      ...emptyNativeHealthSignals("apple_health", "permission_denied", localDate, timeZone),
      collectionTrace: trace,
    };
  }

  // getRequestStatusForAuthorization: shouldRequest → system sheet may appear;
  // unnecessary → already determined (instant, no sheet).
  let requestStatus: number | null = null;
  try {
    requestStatus = await healthkit.getRequestStatusForAuthorization({ toRead: [...toRead] });
    trace.notes.push(`getRequestStatusForAuthorization:${String(requestStatus)}`);
  } catch (error) {
    trace.notes.push(`getRequestStatusForAuthorization_error:${error instanceof Error ? error.message : String(error)}`);
  }

  const AuthorizationRequestStatus = healthkit.AuthorizationRequestStatus
    ?? { unknown: 0, shouldRequest: 1, unnecessary: 2 };
  const needsUserPrompt = requestStatus === AuthorizationRequestStatus.shouldRequest
    || (requestStatus == null && !backoff.allowed);

  // Always call requestAuthorization before queries (library requirement). When status
  // is unnecessary / already allowed, this is millisecond-fast and does not show UI.
  // Sheet appears only when status is shouldRequest (first time / not determined).
  trace.permissionPromptAttempted = needsUserPrompt;
  try {
    const ok = await healthkit.requestAuthorization({ toRead: [...toRead] });
    trace.permissionPromptResult = ok === true;
    if (needsUserPrompt) {
      // Only treat false as an explicit denial when we actually asked the user.
      // iOS often returns false for READ grants even when allowed — ignore that
      // when the sheet was not needed (unnecessary).
      if (ok === true) {
        await recordPermissionResult("apple_health", true);
        trace.notes.push("permission_prompt_ok_true");
      } else {
        await recordPermissionResult("apple_health", false);
        finishTrace(trace, "permission_denied");
        trace.notes.push("permission_prompt_denied_cooldown_7d");
        return {
          ...emptyNativeHealthSignals("apple_health", "permission_denied", localDate, timeZone),
          collectionTrace: trace,
        };
      }
    } else {
      if (ok === true || backoff.allowed) {
        await recordPermissionResult("apple_health", true);
      }
      trace.notes.push(
        ok === true
          ? "requestAuthorization_silent_ok"
          : "requestAuthorization_silent_false_ios_read_quirk_still_query",
      );
    }
  } catch (error) {
    trace.permissionPromptResult = false;
    if (needsUserPrompt) {
      await recordPermissionResult("apple_health", false);
      finishTrace(trace, "permission_denied");
      trace.notes.push(`permission_prompt_error:${error instanceof Error ? error.message : String(error)}`);
      return {
        ...emptyNativeHealthSignals("apple_health", "permission_denied", localDate, timeZone),
        collectionTrace: trace,
      };
    }
    trace.notes.push(`requestAuthorization_silent_error:${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const stepAuth = healthkit.authorizationStatusFor("HKQuantityTypeIdentifierStepCount");
    trace.notes.push(`authorizationStatusFor_steps:${String(stepAuth)}`);
  } catch (error) {
    trace.notes.push(`authorizationStatusFor_steps_error:${error instanceof Error ? error.message : String(error)}`);
  }

  // Canary: proves the bridge works at all (independent of day-range filters).
  try {
    const canaryStarted = Date.now();
    const recent = await healthkit.getMostRecentQuantitySample("HKQuantityTypeIdentifierStepCount");
    trace.queries.push({
      metric: "steps_canary_most_recent",
      method: "getMostRecentQuantitySample",
      ok: true,
      parsed: extractQuantityNumber(recent) ?? extractQuantityNumber(recent?.quantity),
      rawPreview: previewRaw(recent),
      error: null,
      durationMs: Date.now() - canaryStarted,
    });
  } catch (error) {
    trace.queries.push({
      metric: "steps_canary_most_recent",
      method: "getMostRecentQuantitySample",
      ok: false,
      parsed: null,
      rawPreview: null,
      error: error instanceof Error ? error.message : String(error),
      durationMs: 0,
    });
    trace.notes.push("canary_most_recent_failed_bridge_or_auth");
  }

  const sampleInRange = (
    sample: { startDate?: Date | string; endDate?: Date | string },
    start: Date,
    end: Date,
  ): boolean => {
    const sampleStart = new Date(sample.startDate ?? 0).getTime();
    const sampleEnd = new Date(sample.endDate ?? sample.startDate ?? 0).getTime();
    if (!Number.isFinite(sampleStart) || !Number.isFinite(sampleEnd)) return false;
    return sampleStart < end.getTime() && sampleEnd > start.getTime();
  };

  const sumQuantitySamples = (
    samples: unknown,
    start: Date,
    end: Date,
  ): { total: number | null; matched: number; totalSamples: number; first: unknown } => {
    const list = Array.isArray(samples) ? samples : [];
    let total = 0;
    let matched = 0;
    for (const sample of list) {
      if (!sample || typeof sample !== "object") continue;
      const row = sample as { startDate?: Date | string; endDate?: Date | string; quantity?: unknown };
      if (!sampleInRange(row, start, end)) continue;
      const quantity =
        extractQuantityNumber(row)
        ?? extractQuantityNumber(row.quantity);
      if (quantity == null || quantity <= 0) continue;
      total += quantity;
      matched += 1;
    }
    return {
      total: total > 0 ? total : null,
      matched,
      totalSamples: list.length,
      first: list[0] ?? null,
    };
  };

  const quantitySum = async (
    metric: string,
    identifier: (typeof toRead)[number],
    unit: string,
    start: Date,
    end: Date,
  ): Promise<number | null> => {
    const started = Date.now();
    const errors: string[] = [];
    const dateFilter = { date: { startDate: start, endDate: end } };

    // 1) Samples with date filter (more reliable than statistics on some Nitro builds).
    try {
      const samples = await healthkit.queryQuantitySamples(identifier as never, {
        unit: unit as never,
        limit: 5000,
        ascending: true,
        filter: dateFilter,
      });
      const summed = sumQuantitySamples(samples, start, end);
      if (summed.total != null) {
        trace.queries.push({
          metric,
          method: "queryQuantitySamples",
          ok: true,
          parsed: summed.total,
          rawPreview: previewRaw({ sampleCount: summed.totalSamples, matched: summed.matched, first: summed.first }),
          error: null,
          durationMs: Date.now() - started,
        });
        return summed.total;
      }
      errors.push(`samples_filter_empty:count=${summed.totalSamples}`);
    } catch (error) {
      errors.push(`samples_filter:${error instanceof Error ? error.message : String(error)}`);
    }

    // 2) Samples without native filter — filter client-side (Nitro DateFilter can throw).
    try {
      const samples = await healthkit.queryQuantitySamples(identifier as never, {
        unit: unit as never,
        limit: 5000,
        ascending: false,
      });
      const list = Array.isArray(samples) ? samples : [];
      const inWindow = list.filter((sample) =>
        sample && typeof sample === "object"
          ? sampleInRange(sample as { startDate?: Date | string; endDate?: Date | string }, start, end)
          : false,
      );
      const summed = sumQuantitySamples(inWindow, start, end);
      if (summed.total != null) {
        trace.queries.push({
          metric,
          method: "queryQuantitySamples_client_date_filter",
          ok: true,
          parsed: summed.total,
          rawPreview: previewRaw({
            fetched: list.length,
            matched: summed.matched,
            firstMatched: inWindow[0] ?? null,
          }),
          error: null,
          durationMs: Date.now() - started,
        });
        return summed.total;
      }
      errors.push(`samples_unfiltered_empty:fetched=${list.length}`);
    } catch (error) {
      errors.push(`samples_unfiltered:${error instanceof Error ? error.message : String(error)}`);
    }

    // 3) Statistics cumulative sum.
    try {
      const result = await healthkit.queryStatisticsForQuantity(identifier as never, ["cumulativeSum"], {
        unit: unit as never,
        filter: dateFilter,
      });
      const parsed = extractQuantityNumber(result?.sumQuantity);
      if (parsed != null && parsed > 0) {
        trace.queries.push({
          metric,
          method: "queryStatisticsForQuantity",
          ok: true,
          parsed,
          rawPreview: previewRaw(result?.sumQuantity),
          error: null,
          durationMs: Date.now() - started,
        });
        return parsed;
      }
      errors.push("statistics_empty_or_non_positive");
    } catch (error) {
      errors.push(`statistics:${error instanceof Error ? error.message : String(error)}`);
    }

    trace.queries.push({
      metric,
      method: "quantitySum_exhausted",
      ok: false,
      parsed: null,
      rawPreview: previewRaw({ start: start.toISOString(), end: end.toISOString() }),
      error: errors.join(" | "),
      durationMs: Date.now() - started,
    });
    return null;
  };

  const sleepMinutes = async (metric: string, start: Date, end: Date): Promise<number | null> => {
    const started = Date.now();
    const asleepValues = new Set([1, 3, 4, 5]);
    const errors: string[] = [];
    const sumSleep = (samples: unknown) => {
      const list = Array.isArray(samples) ? samples : [];
      const matched = list.filter((sample) => {
        if (!sample || typeof sample !== "object") return false;
        const row = sample as { value?: unknown; startDate?: Date | string; endDate?: Date | string };
        if (!asleepValues.has(Number(row.value))) return false;
        return sampleInRange(row, start, end);
      });
      const total = matched.reduce(
        (sum, sample) =>
          sum
          + minutesBetween(
            (sample as { startDate: Date | string }).startDate,
            (sample as { endDate: Date | string }).endDate,
          ),
        0,
      );
      return { total: total > 0 ? total : null, matched: matched.length, totalSamples: list.length, first: matched[0] ?? list[0] ?? null };
    };

    try {
      const samples = await healthkit.queryCategorySamples("HKCategoryTypeIdentifierSleepAnalysis", {
        limit: 500,
        ascending: true,
        filter: { date: { startDate: start, endDate: end } },
      });
      const summed = sumSleep(samples);
      if (summed.total != null) {
        trace.queries.push({
          metric,
          method: "queryCategorySamples",
          ok: true,
          parsed: summed.total,
          rawPreview: previewRaw({ sampleCount: summed.totalSamples, matched: summed.matched, first: summed.first }),
          error: null,
          durationMs: Date.now() - started,
        });
        return summed.total;
      }
      errors.push(`filter_empty:count=${summed.totalSamples}`);
    } catch (error) {
      errors.push(`filter:${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const samples = await healthkit.queryCategorySamples("HKCategoryTypeIdentifierSleepAnalysis", {
        limit: 500,
        ascending: false,
      });
      const summed = sumSleep(samples);
      if (summed.total != null) {
        trace.queries.push({
          metric,
          method: "queryCategorySamples_client_date_filter",
          ok: true,
          parsed: summed.total,
          rawPreview: previewRaw({ sampleCount: summed.totalSamples, matched: summed.matched, first: summed.first }),
          error: null,
          durationMs: Date.now() - started,
        });
        return summed.total;
      }
      errors.push(`unfiltered_empty:count=${summed.totalSamples}`);
    } catch (error) {
      errors.push(`unfiltered:${error instanceof Error ? error.message : String(error)}`);
    }

    trace.queries.push({
      metric,
      method: "sleepMinutes_exhausted",
      ok: false,
      parsed: null,
      rawPreview: previewRaw({ start: start.toISOString(), end: end.toISOString() }),
      error: errors.join(" | "),
      durationMs: Date.now() - started,
    });
    return null;
  };

  // Run day metrics sequentially — parallel Nitro HealthKit calls were failing
  // instantly with "Unknown std::runtime_error" on device (see QA export text-446C).
  const queryWindow = async (start: Date, end: Date, label: string) => {
    const averageStart = addDays(start, -AVERAGE_DAYS);
    const steps = await quantitySum(`steps${label}`, "HKQuantityTypeIdentifierStepCount", "count", start, end);
    const stepsWindow = await quantitySum(
      `steps_avg_window${label}`,
      "HKQuantityTypeIdentifierStepCount",
      "count",
      averageStart,
      start,
    );
    const calories = await quantitySum(
      `active_calories${label}`,
      "HKQuantityTypeIdentifierActiveEnergyBurned",
      "kcal",
      start,
      end,
    );
    const caloriesWindow = await quantitySum(
      `active_calories_avg_window${label}`,
      "HKQuantityTypeIdentifierActiveEnergyBurned",
      "kcal",
      averageStart,
      start,
    );
    const workout = await quantitySum(
      `workout_minutes${label}`,
      "HKQuantityTypeIdentifierAppleExerciseTime",
      "min",
      start,
      end,
    );
    const workoutWindow = await quantitySum(
      `workout_minutes_avg_window${label}`,
      "HKQuantityTypeIdentifierAppleExerciseTime",
      "min",
      averageStart,
      start,
    );
    const sleep = await sleepMinutes(`sleep_minutes${label}`, start, end);
    const sleepWindow = await sleepMinutes(`sleep_minutes_avg_window${label}`, averageStart, start);
    return { steps, stepsWindow, calories, caloriesWindow, workout, workoutWindow, sleep, sleepWindow };
  };

  let range = localDayRange(localDate, timeZone);
  trace.rangeStartIso = range.start.toISOString();
  trace.rangeEndIso = range.end.toISOString();
  let window = await queryWindow(range.start, range.end, "");

  const allEmpty =
    (window.steps == null || window.steps <= 0)
    && (window.calories == null || window.calories <= 0)
    && (window.workout == null || window.workout <= 0)
    && (window.sleep == null || window.sleep <= 0);

  // If plan timezone produced an empty day, retry with the device calendar day
  // (common when TZ string is wrong/UTC while HealthKit samples are local).
  if (allEmpty && timeZone) {
    const deviceRange = localDayRange(localDate, null);
    const sameRange =
      deviceRange.start.getTime() === range.start.getTime()
      && deviceRange.end.getTime() === range.end.getTime();
    if (!sameRange) {
      trace.notes.push("retry_device_local_day_after_empty_timezone_range");
      range = deviceRange;
      trace.rangeStartIso = range.start.toISOString();
      trace.rangeEndIso = range.end.toISOString();
      window = await queryWindow(range.start, range.end, "_device_local");
    }
  }

  const { steps, stepsWindow, calories, caloriesWindow, workout, workoutWindow, sleep, sleepWindow } = window;

  const stepsOrNull = steps != null && steps > 0 ? steps : null;
  const caloriesOrNull = calories != null && calories > 0 ? calories : null;
  const workoutOrNull = workout != null && workout > 0 ? workout : null;
  const sleepOrNull = sleep != null && sleep > 0 ? sleep : null;

  if (stepsOrNull == null && caloriesOrNull == null && workoutOrNull == null && sleepOrNull == null) {
    trace.notes.push("all_metrics_empty_after_query");
  }

  finishTrace(trace, "available");
  return {
    provider: "apple_health",
    providerStatus: "available",
    activity: {
      steps: metric(stepsOrNull, stepsWindow == null || stepsWindow <= 0 ? null : stepsWindow / AVERAGE_DAYS),
      activeCalories: metric(caloriesOrNull, caloriesWindow == null || caloriesWindow <= 0 ? null : caloriesWindow / AVERAGE_DAYS),
      workoutMinutes: metric(workoutOrNull, workoutWindow == null || workoutWindow <= 0 ? null : workoutWindow / AVERAGE_DAYS),
    },
    sleep: {
      durationMinutes: metric(sleepOrNull, sleepWindow == null || sleepWindow <= 0 ? null : sleepWindow / AVERAGE_DAYS),
      quality: sleepQuality(sleepOrNull),
    },
    collectionTrace: trace,
  };
}

async function collectGoogleHealth(localDate: string, timeZone?: string | null): Promise<NativeHealthSignals> {
  const trace = emptyTrace("google_health", localDate, timeZone);
  if (Platform.OS !== "android") {
    finishTrace(trace, "unavailable");
    trace.notes.push("not_android");
    return { ...emptyNativeHealthSignals("google_health", "unavailable", localDate, timeZone), collectionTrace: trace };
  }
  const healthConnect = await import("react-native-health-connect");
  const status = await healthConnect.getSdkStatus(HEALTH_CONNECT_PROVIDER_PACKAGE);
  if (status !== healthConnect.SdkAvailabilityStatus.SDK_AVAILABLE) {
    finishTrace(trace, "unavailable");
    trace.notes.push(`sdk_status_${String(status)}`);
    return { ...emptyNativeHealthSignals("google_health", "unavailable", localDate, timeZone), collectionTrace: trace };
  }
  const initialized = await healthConnect.initialize(HEALTH_CONNECT_PROVIDER_PACKAGE);
  if (!initialized) {
    finishTrace(trace, "unavailable");
    trace.notes.push("initialize_failed");
    return { ...emptyNativeHealthSignals("google_health", "unavailable", localDate, timeZone), collectionTrace: trace };
  }

  const granted = await healthConnect.getGrantedPermissions();
  const hasAll = PERMISSION_RECORDS.every((permission) =>
    granted.some((item) => item.accessType === permission.accessType && item.recordType === permission.recordType),
  );

  const backoff = await readBackoff("google_health");
  if (!hasAll && isDenialCooldownActive(backoff)) {
    finishTrace(trace, "permission_denied");
    trace.notes.push(
      `denial_cooldown_active_until:${backoff.nextPromptAt}`,
      `deniedCount:${backoff.deniedCount}`,
    );
    return {
      ...emptyNativeHealthSignals("google_health", "permission_denied", localDate, timeZone),
      collectionTrace: trace,
    };
  }

  if (!hasAll) {
    // No grant yet (or cooldown expired) → ask the user once.
    trace.permissionPromptAttempted = true;
    const nextGranted = await healthConnect.requestPermission(PERMISSION_RECORDS);
    const allowed = PERMISSION_RECORDS.every((permission) =>
      nextGranted.some((item) => item.accessType === permission.accessType && item.recordType === permission.recordType),
    );
    trace.permissionPromptResult = allowed;
    await recordPermissionResult("google_health", allowed);
    if (!allowed) {
      finishTrace(trace, "permission_denied");
      trace.notes.push("permission_prompt_denied_cooldown_7d");
      return {
        ...emptyNativeHealthSignals("google_health", "permission_denied", localDate, timeZone),
        collectionTrace: trace,
      };
    }
  } else if (!backoff.allowed) {
    await recordPermissionResult("google_health", true);
    trace.notes.push("permissions_already_granted");
  }

  let range = localDayRange(localDate, timeZone);
  trace.rangeStartIso = range.start.toISOString();
  trace.rangeEndIso = range.end.toISOString();
  const timeRange = (start: Date, end: Date) => ({ operator: "between" as const, startTime: start.toISOString(), endTime: end.toISOString() });
  const aggregate = async <T extends "Steps" | "ActiveCaloriesBurned" | "ExerciseSession" | "SleepSession">(
    metric: string,
    recordType: T,
    start: Date,
    end: Date,
  ) => {
    const started = Date.now();
    try {
      const result = await healthConnect.aggregateRecord({ recordType, timeRangeFilter: timeRange(start, end) });
      trace.queries.push({
        metric,
        method: `aggregateRecord:${recordType}`,
        ok: true,
        parsed: null,
        rawPreview: previewRaw(result),
        error: null,
        durationMs: Date.now() - started,
      });
      return result;
    } catch (error) {
      trace.queries.push({
        metric,
        method: `aggregateRecord:${recordType}`,
        ok: false,
        parsed: null,
        rawPreview: null,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started,
      });
      return null;
    }
  };

  const runAggregates = async (start: Date, end: Date, label: string) => {
    const avgStart = addDays(start, -AVERAGE_DAYS);
    return Promise.all([
      aggregate(`steps${label}`, "Steps", start, end),
      aggregate(`steps_avg_window${label}`, "Steps", avgStart, start),
      aggregate(`active_calories${label}`, "ActiveCaloriesBurned", start, end),
      aggregate(`active_calories_avg_window${label}`, "ActiveCaloriesBurned", avgStart, start),
      aggregate(`workout_minutes${label}`, "ExerciseSession", start, end),
      aggregate(`workout_minutes_avg_window${label}`, "ExerciseSession", avgStart, start),
      aggregate(`sleep_minutes${label}`, "SleepSession", start, end),
      aggregate(`sleep_minutes_avg_window${label}`, "SleepSession", avgStart, start),
    ]);
  };

  let [steps, stepsWindow, calories, caloriesWindow, workout, workoutWindow, sleep, sleepWindow] = await runAggregates(
    range.start,
    range.end,
    "",
  );

  const parseSleepMinutes = (raw: unknown): number | null => {
    if (!raw || typeof raw !== "object" || !("SLEEP_DURATION_TOTAL" in raw)) return null;
    const total = Number((raw as { SLEEP_DURATION_TOTAL?: unknown }).SLEEP_DURATION_TOTAL);
    if (!Number.isFinite(total) || total <= 0) return null;
    // Health Connect may report seconds or milliseconds depending on version.
    if (total > 24 * 60 * 60 * 7) return total / 1000 / 60;
    return total / 60;
  };

  const parseWindow = (
    stepsRaw: unknown,
    stepsWindowRaw: unknown,
    caloriesRaw: unknown,
    caloriesWindowRaw: unknown,
    workoutRaw: unknown,
    workoutWindowRaw: unknown,
    sleepRaw: unknown,
    sleepWindowRaw: unknown,
  ) => {
    const rawSteps = stepsRaw && typeof stepsRaw === "object" && "COUNT_TOTAL" in stepsRaw ? Number((stepsRaw as { COUNT_TOTAL?: unknown }).COUNT_TOTAL) : null;
    const rawStepsAverage =
      stepsWindowRaw && typeof stepsWindowRaw === "object" && "COUNT_TOTAL" in stepsWindowRaw
        ? Number((stepsWindowRaw as { COUNT_TOTAL?: unknown }).COUNT_TOTAL) / AVERAGE_DAYS
        : null;
    const rawCalories =
      caloriesRaw && typeof caloriesRaw === "object" && "ACTIVE_CALORIES_TOTAL" in caloriesRaw
        ? Number((caloriesRaw as { ACTIVE_CALORIES_TOTAL?: { inKilocalories?: unknown } }).ACTIVE_CALORIES_TOTAL?.inKilocalories)
        : null;
    const rawCaloriesAverage =
      caloriesWindowRaw && typeof caloriesWindowRaw === "object" && "ACTIVE_CALORIES_TOTAL" in caloriesWindowRaw
        ? Number((caloriesWindowRaw as { ACTIVE_CALORIES_TOTAL?: { inKilocalories?: unknown } }).ACTIVE_CALORIES_TOTAL?.inKilocalories) / AVERAGE_DAYS
        : null;
    const rawWorkout =
      workoutRaw && typeof workoutRaw === "object" && "EXERCISE_DURATION_TOTAL" in workoutRaw
        ? Number((workoutRaw as { EXERCISE_DURATION_TOTAL?: { inSeconds?: unknown } }).EXERCISE_DURATION_TOTAL?.inSeconds) / 60
        : null;
    const rawWorkoutAverage =
      workoutWindowRaw && typeof workoutWindowRaw === "object" && "EXERCISE_DURATION_TOTAL" in workoutWindowRaw
        ? Number((workoutWindowRaw as { EXERCISE_DURATION_TOTAL?: { inSeconds?: unknown } }).EXERCISE_DURATION_TOTAL?.inSeconds) / 60 / AVERAGE_DAYS
        : null;
    const rawSleep = parseSleepMinutes(sleepRaw);
    const rawSleepWindow = parseSleepMinutes(sleepWindowRaw);
    const rawSleepAverage = rawSleepWindow != null ? rawSleepWindow / AVERAGE_DAYS : null;
    return {
      stepsValue: rawSteps != null && rawSteps > 0 ? rawSteps : null,
      stepsAverage: rawStepsAverage != null && rawStepsAverage > 0 ? rawStepsAverage : null,
      caloriesValue: rawCalories != null && rawCalories > 0 ? rawCalories : null,
      caloriesAverage: rawCaloriesAverage != null && rawCaloriesAverage > 0 ? rawCaloriesAverage : null,
      workoutValue: rawWorkout != null && rawWorkout > 0 ? rawWorkout : null,
      workoutAverage: rawWorkoutAverage != null && rawWorkoutAverage > 0 ? rawWorkoutAverage : null,
      sleepValue: rawSleep != null && rawSleep > 0 ? rawSleep : null,
      sleepAverage: rawSleepAverage != null && rawSleepAverage > 0 ? rawSleepAverage : null,
    };
  };

  let parsed = parseWindow(steps, stepsWindow, calories, caloriesWindow, workout, workoutWindow, sleep, sleepWindow);
  if (
    parsed.stepsValue == null
    && parsed.caloriesValue == null
    && parsed.workoutValue == null
    && parsed.sleepValue == null
    && timeZone
  ) {
    const deviceRange = localDayRange(localDate, null);
    const sameRange =
      deviceRange.start.getTime() === range.start.getTime()
      && deviceRange.end.getTime() === range.end.getTime();
    if (!sameRange) {
      trace.notes.push("retry_device_local_day_after_empty_timezone_range");
      range = deviceRange;
      trace.rangeStartIso = range.start.toISOString();
      trace.rangeEndIso = range.end.toISOString();
      [steps, stepsWindow, calories, caloriesWindow, workout, workoutWindow, sleep, sleepWindow] = await runAggregates(
        range.start,
        range.end,
        "_device_local",
      );
      parsed = parseWindow(steps, stepsWindow, calories, caloriesWindow, workout, workoutWindow, sleep, sleepWindow);
    }
  }

  const {
    stepsValue,
    stepsAverage,
    caloriesValue,
    caloriesAverage,
    workoutValue,
    workoutAverage,
    sleepValue,
    sleepAverage,
  } = parsed;

  for (const [metricName, value] of [
    ["steps", stepsValue],
    ["active_calories", caloriesValue],
    ["workout_minutes", workoutValue],
    ["sleep_minutes", sleepValue],
  ] as const) {
    const existing = trace.queries.find((item) => item.metric === metricName || item.metric === `${metricName}_device_local`);
    if (existing) existing.parsed = value;
  }

  if (stepsValue == null && caloriesValue == null && workoutValue == null && sleepValue == null) {
    trace.notes.push("all_metrics_empty_after_query");
  }

  finishTrace(trace, "available");
  return {
    provider: "google_health",
    providerStatus: "available",
    activity: {
      steps: metric(stepsValue, stepsAverage),
      activeCalories: metric(caloriesValue, caloriesAverage),
      workoutMinutes: metric(workoutValue, workoutAverage),
    },
    sleep: {
      durationMinutes: metric(sleepValue, sleepAverage),
      quality: sleepQuality(sleepValue),
    },
    collectionTrace: trace,
  };
}

export async function collectNativeHealthSignals(
  localDate: string,
  timeZone?: string | null,
): Promise<NativeHealthSignals> {
  try {
    if (Platform.OS === "ios") return await collectAppleHealth(localDate, timeZone);
    if (Platform.OS === "android") return await collectGoogleHealth(localDate, timeZone);
    return emptyNativeHealthSignals("google_health", "unavailable", localDate, timeZone, ["unsupported_platform"]);
  } catch (error) {
    if (__DEV__) console.warn("[nativeHealth] failed to collect native health signals", error);
    return emptyNativeHealthSignals(
      Platform.OS === "ios" ? "apple_health" : "google_health",
      "unavailable",
      localDate,
      timeZone,
      [`collect_threw:${error instanceof Error ? error.message : String(error)}`],
    );
  }
}
