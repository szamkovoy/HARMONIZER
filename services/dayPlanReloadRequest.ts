import type { DayPlan } from "@/services/dayPlan";

let prefetchedDayPlan: DayPlan | null = null;

export function storePrefetchedDayPlan(plan: DayPlan): void {
  prefetchedDayPlan = plan;
}

export function consumePrefetchedDayPlan(): DayPlan | null {
  const next = prefetchedDayPlan;
  prefetchedDayPlan = null;
  return next;
}
