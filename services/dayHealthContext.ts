import type { DayPlan, DayPracticeLog } from "@/services/dayPlan";
import { collectNativeHealthSignals } from "@/services/nativeHealth";
import { requireSupabase } from "@/services/supabase";

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
};

function compare(value: number | null, average: number | null, toleranceRatio = 0.15): DayHealthMetricComparison {
  if (value == null || average == null || average <= 0) return "unknown";
  const deltaRatio = (value - average) / average;
  if (Math.abs(deltaRatio) <= toleranceRatio) return "similar";
  return deltaRatio > 0 ? "higher" : "lower";
}

function practiceKindFromTitle(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes("дых")) return "дыхание";
  if (lower.includes("медитац")) return "медитация";
  if (lower.includes("асан")) return "асаны";
  return title.trim();
}

async function loadAverageYogaMinutes(limit = 7): Promise<number | null> {
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

export async function collectDayHealthContextForDate(localDate: string, practices: DayPracticeLog[]): Promise<DayHealthContext> {
  const yogaTotalMinutes = Math.round(
    practices.reduce((sum, practice) => sum + Math.max(0, practice.durationSec ?? 0), 0) / 60,
  );
  const averageDailyMinutes = await loadAverageYogaMinutes();
  const kinds = [...new Set(practices.map((practice) => practiceKindFromTitle(practice.title)).filter(Boolean))];
  const nativeHealth = await collectNativeHealthSignals(localDate);

  return {
    localDate,
    provider: nativeHealth.provider,
    providerStatus: nativeHealth.providerStatus,
    yoga: {
      totalMinutes: yogaTotalMinutes,
      practiceCount: practices.length,
      kinds,
      averageDailyMinutes,
      comparison: compare(yogaTotalMinutes, averageDailyMinutes),
    },
    activity: {
      steps: nativeHealth.activity.steps,
      activeCalories: nativeHealth.activity.activeCalories,
      workoutMinutes: nativeHealth.activity.workoutMinutes,
    },
    sleep: {
      durationMinutes: nativeHealth.sleep.durationMinutes,
      quality: nativeHealth.sleep.quality,
    },
  };
}

export async function collectDayHealthContext(plan: DayPlan): Promise<DayHealthContext> {
  const targetDate = plan.summaryTargetLocalDate ?? plan.currentLocalDate;
  const section = plan.sections.find((item) => item.localDate === targetDate) ?? plan.sections[0];
  return collectDayHealthContextForDate(targetDate, section?.practices ?? []);
}
