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
    collectionTrace: null,
  };
}

export type SummarizingHealthCollection = {
  getSnapshot: () => DayHealthContext;
  whenReady: () => Promise<DayHealthContext>;
};

function dayHealthRichnessScore(ctx: DayHealthContext): number {
  let score = 0;
  if (ctx.providerStatus === "available") score += 2;
  if (ctx.activity.steps.value != null && ctx.activity.steps.value > 0) score += 3;
  if (ctx.activity.activeCalories.value != null && ctx.activity.activeCalories.value > 0) score += 1;
  if (ctx.activity.workoutMinutes.value != null && ctx.activity.workoutMinutes.value > 0) score += 1;
  if (ctx.sleep.durationMinutes.value != null && ctx.sleep.durationMinutes.value > 0) score += 3;
  if (ctx.yoga.totalMinutes > 0 || ctx.yoga.practiceCount > 0) score += 1;
  if (ctx.yoga.averageDailyMinutes != null) score += 1;
  return score;
}

/** Prefer the snapshot that already has concrete Apple/Google metrics. */
export function preferRicherDayHealth(
  left: DayHealthContext | null | undefined,
  right: DayHealthContext | null | undefined,
): DayHealthContext | null {
  if (!left) return right ?? null;
  if (!right) return left;
  return dayHealthRichnessScore(left) >= dayHealthRichnessScore(right) ? left : right;
}

/**
 * Start health collection at summarizing open. Native Apple/Google Health loads
 * in the background for the whole branch — later POSTs send getSnapshot().
 */
export function startSummarizingHealthCollection(params: {
  localDate: string;
  practices: DayPracticeLog[];
  timeZone?: string | null;
}): SummarizingHealthCollection {
  let snapshot = buildSummarizingHealthSnapshot(params.localDate, params.practices);
  const startedAt = Date.now();
  if (__DEV__) {
    // eslint-disable-next-line no-console
    console.log("[summarizingHealthContext] native health collection STARTED", {
      localDate: params.localDate,
      timeZone: params.timeZone ?? null,
      at: new Date(startedAt).toISOString(),
    });
  }
  const ready = (async () => {
    const [averageDailyMinutes, nativeHealth] = await Promise.all([
      loadAverageYogaMinutes(),
      collectNativeHealthSignals(params.localDate, params.timeZone),
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
      collectionTrace: nativeHealth.collectionTrace,
    };
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log("[summarizingHealthContext] native health collection READY", {
        localDate: params.localDate,
        timeZone: params.timeZone ?? null,
        durationMs: Date.now() - startedAt,
        provider: nativeHealth.provider,
        providerStatus: nativeHealth.providerStatus,
        steps: nativeHealth.activity.steps.value,
        sleepMinutes: nativeHealth.sleep.durationMinutes.value,
        notes: nativeHealth.collectionTrace.notes,
        queries: nativeHealth.collectionTrace.queries.map((q) => ({
          metric: q.metric,
          method: q.method,
          ok: q.ok,
          parsed: q.parsed,
          error: q.error,
        })),
      });
    }
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
    timeZone: plan.timezone,
  });
}
