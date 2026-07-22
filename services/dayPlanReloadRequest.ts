import type { DayPlan } from "@/services/dayPlan";

let prefetchedDayPlan: DayPlan | null = null;
let dayPlanStale = false;

type PrefetchListener = (plan: DayPlan) => void;
const prefetchListeners = new Set<PrefetchListener>();

/** Call after mutations that make any cached/in-memory Day plan outdated (e.g. practice completed). */
export function markDayPlanStale(): void {
  dayPlanStale = true;
  prefetchedDayPlan = null;
}

export function consumeDayPlanStale(): boolean {
  const next = dayPlanStale;
  dayPlanStale = false;
  return next;
}

export function clearPrefetchedDayPlan(): void {
  prefetchedDayPlan = null;
}

export function peekPrefetchedDayPlan(): DayPlan | null {
  return prefetchedDayPlan;
}

export function storePrefetchedDayPlan(plan: DayPlan): void {
  prefetchedDayPlan = plan;
  for (const listener of prefetchListeners) {
    try {
      listener(plan);
    } catch {
      /* ignore listener errors */
    }
  }
}

/** One-shot take — prefer peek + clear after apply so late subscribers can still paint. */
export function consumePrefetchedDayPlan(): DayPlan | null {
  const next = prefetchedDayPlan;
  prefetchedDayPlan = null;
  return next;
}

/** Day tab: apply plan when Home prefetch finishes after the user already focused Day. */
export function subscribePrefetchedDayPlan(listener: PrefetchListener): () => void {
  prefetchListeners.add(listener);
  // Replay current snapshot so a late subscriber does not miss an already-stored plan.
  if (prefetchedDayPlan) {
    try {
      listener(prefetchedDayPlan);
    } catch {
      /* ignore */
    }
  }
  return () => {
    prefetchListeners.delete(listener);
  };
}
