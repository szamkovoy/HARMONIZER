import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

import type { DayHealthMetric, DayHealthMetricComparison } from "@/services/dayHealthContext";

export type NativeHealthProvider = "apple_health" | "google_health";

export type NativeHealthSignals = {
  provider: NativeHealthProvider;
  providerStatus: "available" | "unavailable" | "permission_denied";
  activity: {
    steps: DayHealthMetric;
    activeCalories: DayHealthMetric;
    workoutMinutes: DayHealthMetric;
  };
  sleep: {
    durationMinutes: DayHealthMetric;
    quality: "good" | "fragmented" | "short" | "long" | "unknown";
  };
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

function emptyMetric(): DayHealthMetric {
  return { value: null, average: null, comparison: "unknown" };
}

export function emptyNativeHealthSignals(provider: NativeHealthProvider, providerStatus: NativeHealthSignals["providerStatus"]): NativeHealthSignals {
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
  };
}

function localDayRange(localDate: string): DayRange {
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

function averageNonZero(values: number[]): number | null {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0);
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
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

function canPrompt(value: PermissionBackoff, now = new Date()): boolean {
  if (value.allowed) return false;
  if (!value.nextPromptAt) return true;
  return new Date(value.nextPromptAt).getTime() <= now.getTime();
}

async function recordPermissionResult(provider: NativeHealthProvider, allowed: boolean) {
  const current = await readBackoff(provider);
  const now = new Date();
  if (allowed) {
    await writeBackoff(provider, { allowed: true, deniedCount: current.deniedCount, lastPromptAt: now.toISOString(), nextPromptAt: null });
    return;
  }
  const deniedCount = current.deniedCount + 1;
  const delayDays = deniedCount === 1 ? 1 : deniedCount === 2 ? 7 : 30;
  await writeBackoff(provider, {
    allowed: false,
    deniedCount,
    lastPromptAt: now.toISOString(),
    nextPromptAt: addDays(now, delayDays).toISOString(),
  });
}

async function shouldRequestPermissions(provider: NativeHealthProvider): Promise<boolean> {
  const current = await readBackoff(provider);
  return canPrompt(current);
}

async function collectAppleHealth(localDate: string): Promise<NativeHealthSignals> {
  if (Platform.OS !== "ios") return emptyNativeHealthSignals("apple_health", "unavailable");
  const healthkit = await import("@kingstinct/react-native-healthkit");
  if (!(await healthkit.isHealthDataAvailableAsync())) {
    return emptyNativeHealthSignals("apple_health", "unavailable");
  }
  const toRead = [
    "HKQuantityTypeIdentifierStepCount",
    "HKQuantityTypeIdentifierActiveEnergyBurned",
    "HKQuantityTypeIdentifierAppleExerciseTime",
    "HKCategoryTypeIdentifierSleepAnalysis",
    "HKWorkoutTypeIdentifier",
  ] as const;
  if (await shouldRequestPermissions("apple_health")) {
    try {
      const ok = await healthkit.requestAuthorization({ toRead });
      await recordPermissionResult("apple_health", ok);
      if (!ok) return emptyNativeHealthSignals("apple_health", "permission_denied");
    } catch {
      await recordPermissionResult("apple_health", false);
      return emptyNativeHealthSignals("apple_health", "permission_denied");
    }
  }
  const range = localDayRange(localDate);
  const averageStart = addDays(range.start, -AVERAGE_DAYS);

  const quantitySum = async (identifier: (typeof toRead)[number], unit: string, start: Date, end: Date) => {
    try {
      const result = await healthkit.queryStatisticsForQuantity(identifier as never, ["cumulativeSum"], {
        unit: unit as never,
        filter: { date: { startDate: start, endDate: end, strictStartDate: true, strictEndDate: true } },
      });
      return result.sumQuantity?.quantity ?? null;
    } catch {
      return null;
    }
  };
  const sleepMinutes = async (start: Date, end: Date) => {
    try {
      const samples = await healthkit.queryCategorySamples("HKCategoryTypeIdentifierSleepAnalysis", {
        limit: 0,
        filter: { date: { startDate: start, endDate: end, strictStartDate: true, strictEndDate: true } },
      });
      return samples
        .filter((sample) => Number(sample.value) === 1 || Number(sample.value) === 3 || Number(sample.value) === 4 || Number(sample.value) === 5)
        .reduce((sum, sample) => sum + minutesBetween(sample.startDate, sample.endDate), 0);
    } catch {
      return null;
    }
  };

  const [steps, stepsWindow, calories, caloriesWindow, workout, workoutWindow, sleep, sleepWindow] = await Promise.all([
    quantitySum("HKQuantityTypeIdentifierStepCount", "count", range.start, range.end),
    quantitySum("HKQuantityTypeIdentifierStepCount", "count", averageStart, range.start),
    quantitySum("HKQuantityTypeIdentifierActiveEnergyBurned", "kcal", range.start, range.end),
    quantitySum("HKQuantityTypeIdentifierActiveEnergyBurned", "kcal", averageStart, range.start),
    quantitySum("HKQuantityTypeIdentifierAppleExerciseTime", "min", range.start, range.end),
    quantitySum("HKQuantityTypeIdentifierAppleExerciseTime", "min", averageStart, range.start),
    sleepMinutes(range.start, range.end),
    sleepMinutes(averageStart, range.start),
  ]);

  return {
    provider: "apple_health",
    providerStatus: "available",
    activity: {
      steps: metric(steps, stepsWindow == null ? null : stepsWindow / AVERAGE_DAYS),
      activeCalories: metric(calories, caloriesWindow == null ? null : caloriesWindow / AVERAGE_DAYS),
      workoutMinutes: metric(workout, workoutWindow == null ? null : workoutWindow / AVERAGE_DAYS),
    },
    sleep: {
      durationMinutes: metric(sleep, sleepWindow == null ? null : sleepWindow / AVERAGE_DAYS),
      quality: sleepQuality(sleep),
    },
  };
}

async function collectGoogleHealth(localDate: string): Promise<NativeHealthSignals> {
  if (Platform.OS !== "android") return emptyNativeHealthSignals("google_health", "unavailable");
  const healthConnect = await import("react-native-health-connect");
  const status = await healthConnect.getSdkStatus(HEALTH_CONNECT_PROVIDER_PACKAGE);
  if (status !== healthConnect.SdkAvailabilityStatus.SDK_AVAILABLE) {
    return emptyNativeHealthSignals("google_health", "unavailable");
  }
  const initialized = await healthConnect.initialize(HEALTH_CONNECT_PROVIDER_PACKAGE);
  if (!initialized) return emptyNativeHealthSignals("google_health", "unavailable");

  const granted = await healthConnect.getGrantedPermissions();
  const hasAll = PERMISSION_RECORDS.every((permission) =>
    granted.some((item) => item.accessType === permission.accessType && item.recordType === permission.recordType),
  );
  if (!hasAll && await shouldRequestPermissions("google_health")) {
    const nextGranted = await healthConnect.requestPermission(PERMISSION_RECORDS);
    const allowed = PERMISSION_RECORDS.every((permission) =>
      nextGranted.some((item) => item.accessType === permission.accessType && item.recordType === permission.recordType),
    );
    await recordPermissionResult("google_health", allowed);
    if (!allowed) return emptyNativeHealthSignals("google_health", "permission_denied");
  } else if (!hasAll) {
    return emptyNativeHealthSignals("google_health", "permission_denied");
  }

  const range = localDayRange(localDate);
  const averageStart = addDays(range.start, -AVERAGE_DAYS);
  const timeRange = (start: Date, end: Date) => ({ operator: "between" as const, startTime: start.toISOString(), endTime: end.toISOString() });
  const aggregate = async <T extends "Steps" | "ActiveCaloriesBurned" | "ExerciseSession" | "SleepSession">(recordType: T, start: Date, end: Date) => {
    try {
      return await healthConnect.aggregateRecord({ recordType, timeRangeFilter: timeRange(start, end) });
    } catch {
      return null;
    }
  };
  const [steps, stepsWindow, calories, caloriesWindow, workout, workoutWindow, sleep, sleepWindow] = await Promise.all([
    aggregate("Steps", range.start, range.end),
    aggregate("Steps", averageStart, range.start),
    aggregate("ActiveCaloriesBurned", range.start, range.end),
    aggregate("ActiveCaloriesBurned", averageStart, range.start),
    aggregate("ExerciseSession", range.start, range.end),
    aggregate("ExerciseSession", averageStart, range.start),
    aggregate("SleepSession", range.start, range.end),
    aggregate("SleepSession", averageStart, range.start),
  ]);
  const stepsValue = steps && "COUNT_TOTAL" in steps ? steps.COUNT_TOTAL : null;
  const stepsAverage = stepsWindow && "COUNT_TOTAL" in stepsWindow ? stepsWindow.COUNT_TOTAL / AVERAGE_DAYS : null;
  const caloriesValue = calories && "ACTIVE_CALORIES_TOTAL" in calories ? calories.ACTIVE_CALORIES_TOTAL.inKilocalories : null;
  const caloriesAverage = caloriesWindow && "ACTIVE_CALORIES_TOTAL" in caloriesWindow ? caloriesWindow.ACTIVE_CALORIES_TOTAL.inKilocalories / AVERAGE_DAYS : null;
  const workoutValue = workout && "EXERCISE_DURATION_TOTAL" in workout ? workout.EXERCISE_DURATION_TOTAL.inSeconds / 60 : null;
  const workoutAverage = workoutWindow && "EXERCISE_DURATION_TOTAL" in workoutWindow ? workoutWindow.EXERCISE_DURATION_TOTAL.inSeconds / 60 / AVERAGE_DAYS : null;
  const sleepValue = sleep && "SLEEP_DURATION_TOTAL" in sleep ? sleep.SLEEP_DURATION_TOTAL / 60 : null;
  const sleepAverage = sleepWindow && "SLEEP_DURATION_TOTAL" in sleepWindow ? sleepWindow.SLEEP_DURATION_TOTAL / 60 / AVERAGE_DAYS : null;

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
  };
}

export async function collectNativeHealthSignals(localDate: string): Promise<NativeHealthSignals> {
  try {
    if (Platform.OS === "ios") return await collectAppleHealth(localDate);
    if (Platform.OS === "android") return await collectGoogleHealth(localDate);
    return emptyNativeHealthSignals("google_health", "unavailable");
  } catch (error) {
    if (__DEV__) console.warn("[nativeHealth] failed to collect native health signals", error);
    return emptyNativeHealthSignals(Platform.OS === "ios" ? "apple_health" : "google_health", "unavailable");
  }
}
