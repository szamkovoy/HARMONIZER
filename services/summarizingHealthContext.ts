import type { DayHealthContext, DayHealthMetric } from "@/services/dayHealthContext";
import type { DayPlan, DayPracticeLog } from "@/services/dayPlan";
import { collectNativeHealthSignals } from "@/services/nativeHealth";

function emptyMetric(): DayHealthMetric {
  return { value: null, average: null, comparison: "unknown" };
}

function compare(value: number | null, average: number | null, toleranceRatio = 0.15): DayHealthContext["yoga"]["comparison"] {
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
  const { requireSupabase } = await import("@/services/supabase");
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from("user_daily_stats")
    .select("total_practice_seconds")
    .order("local_date", { ascending: false })
    .limit(limit);
  if (error) {
    if (__DEV__) console.warn("[summarizingHealthContext] yoga baseline failed", error.message);
    return null;
  }
  const values = (data ?? [])
    .map((row) => Number(row.total_practice_seconds))
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length / 60);
}

/** Yoga/app data is available immediately; native health fills in when ready. */
export function buildSummarizingHealthSnapshot(localDate: string, practices: DayPracticeLog[]): DayHealthContext {
  const yogaTotalMinutes = Math.round(
    practices.reduce((sum, practice) => sum + Math.max(0, practice.durationSec ?? 0), 0) / 60,
  );
  const kinds = [...new Set(practices.map((practice) => practiceKindFromTitle(practice.title)).filter(Boolean))];
  return {
    localDate,
    provider: "none",
    providerStatus: "unavailable",
    yoga: {
      totalMinutes: yogaTotalMinutes,
      practiceCount: practices.length,
      kinds,
      averageDailyMinutes: null,
      comparison: "unknown",
    },
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

export type SummarizingHealthCollection = {
  getSnapshot: () => DayHealthContext;
  whenReady: () => Promise<DayHealthContext>;
};

/**
 * Start health collection for the summarizing branch. No startup timeout — native
 * health keeps loading in the background for the whole dialog. Each POST should
 * send getSnapshot(); the final summarizing turn uses whatever is ready by then.
 */
export function startSummarizingHealthCollection(params: {
  localDate: string;
  practices: DayPracticeLog[];
}): SummarizingHealthCollection {
  let snapshot = buildSummarizingHealthSnapshot(params.localDate, params.practices);
  const ready = (async () => {
    const [averageDailyMinutes, nativeHealth] = await Promise.all([
      loadAverageYogaMinutes(),
      collectNativeHealthSignals(params.localDate),
    ]);
    snapshot = {
      localDate: params.localDate,
      provider: nativeHealth.provider,
      providerStatus: nativeHealth.providerStatus,
      yoga: {
        ...snapshot.yoga,
        averageDailyMinutes,
        comparison: compare(snapshot.yoga.totalMinutes, averageDailyMinutes),
      },
      activity: nativeHealth.activity,
      sleep: nativeHealth.sleep,
    };
    return snapshot;
  })();
  return {
    getSnapshot: () => snapshot,
    whenReady: () => ready,
  };
}

export function startSummarizingHealthCollectionFromPlan(plan: DayPlan): SummarizingHealthCollection {
  const localDate = plan.summaryTargetLocalDate ?? plan.currentLocalDate;
  const section = plan.sections.find((item) => item.localDate === localDate) ?? plan.sections[0];
  return startSummarizingHealthCollection({
    localDate,
    practices: section?.practices ?? [],
  });
}
