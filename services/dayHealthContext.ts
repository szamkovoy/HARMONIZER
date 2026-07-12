import type { DayPlan, DayPracticeLog } from "@/services/dayPlan";
import type { NativeHealthCollectionTrace } from "@/services/nativeHealth";
import {
  buildSummarizingHealthSnapshot,
  startSummarizingHealthCollection,
  startSummarizingHealthCollectionFromPlan,
} from "@/services/summarizingHealthContext";

export type DayHealthMetricComparison = "higher" | "lower" | "similar" | "unknown";

export type DayHealthMetric = {
  value: number | null;
  average: number | null;
  comparison: DayHealthMetricComparison;
};

export type DayHealthContext = {
  localDate: string;
  provider: "none" | "apple_health" | "google_health";
  providerStatus: "unavailable" | "available" | "permission_denied";
  yoga: {
    totalMinutes: number;
    practiceCount: number;
    kinds: string[];
    averageDailyMinutes: number | null;
    comparison: DayHealthMetricComparison;
  };
  activity: {
    steps: DayHealthMetric;
    activeCalories: DayHealthMetric;
    workoutMinutes: DayHealthMetric;
  };
  sleep: {
    durationMinutes: DayHealthMetric;
    quality: "good" | "fragmented" | "short" | "long" | "unknown";
  };
  /** Filled when native Apple/Google collection finishes — for dialog export QA. */
  collectionTrace?: NativeHealthCollectionTrace | null;
};

function compare(value: number | null, average: number | null, toleranceRatio = 0.15): DayHealthMetricComparison {
  if (value == null || average == null || average <= 0) return "unknown";
  const deltaRatio = (value - average) / average;
  if (Math.abs(deltaRatio) <= toleranceRatio) return "similar";
  return deltaRatio > 0 ? "higher" : "lower";
}

async function loadAverageYogaMinutes(limit = 7): Promise<number | null> {
  const { requireSupabase } = await import("@/services/supabase");
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("user_daily_stats")
    .select("total_practice_seconds")
    .order("local_date", { ascending: false })
    .limit(limit);
  if (error) {
    if (__DEV__) console.warn("[dayHealthContext] failed to load yoga baseline", error.message);
    return null;
  }
  const values = (data ?? [])
    .map((row) => Number(row.total_practice_seconds))
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length / 60);
}

/** Blocking full collect — prefer startSummarizingHealthCollection for dialog flows. */
export async function collectDayHealthContextForDate(localDate: string, practices: DayPracticeLog[]): Promise<DayHealthContext> {
  const collection = startSummarizingHealthCollection({ localDate, practices });
  return collection.whenReady();
}

export async function collectDayHealthContext(plan: DayPlan): Promise<DayHealthContext> {
  return startSummarizingHealthCollectionFromPlan(plan).whenReady();
}

export { buildSummarizingHealthSnapshot, startSummarizingHealthCollection, startSummarizingHealthCollectionFromPlan };
