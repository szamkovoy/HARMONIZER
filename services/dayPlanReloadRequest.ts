import type { DayPlan } from "@/services/dayPlan";

let prefetchedDayPlan: DayPlan | null = null;
let dayPlanStale = false;

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

export function storePrefetchedDayPlan(plan: DayPlan): void {
  prefetchedDayPlan = plan;
}

export function consumePrefetchedDayPlan(): DayPlan | null {
  const next = prefetchedDayPlan;
  prefetchedDayPlan = null;
  return next;
}
