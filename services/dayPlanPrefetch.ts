/**
 * Session-wide Day tab prefetch: warm SecureStore + /api/day as soon as auth
 * is known, without waiting for Home forecast readiness.
 */
import type { AppLocale } from "@/modules/i18n";
import { isDayPlanCurrent, loadCachedDayPlan } from "@/services/dayPlanCache";
import { loadDayPlan } from "@/services/dayPlan";
import {
  peekPrefetchedDayPlan,
  storePrefetchedDayPlan,
} from "@/services/dayPlanReloadRequest";
import { logRuntimeEvent } from "@/services/runtimeDiagnostics";

let inFlightKey: string | null = null;
let inFlight: Promise<void> | null = null;

function prefetchKey(userId: string, locale: AppLocale): string {
  return `${userId}:${locale}`;
}

/** Fire-and-forget; dedupes concurrent calls for the same user+locale. */
export function ensureDayPlanPrefetch(options: {
  userId: string;
  locale: AppLocale;
  reason?: string;
}): void {
  const userId = options.userId.trim();
  if (!userId) return;
  const key = prefetchKey(userId, options.locale);
  if (inFlight && inFlightKey === key) return;

  inFlightKey = key;
  inFlight = (async () => {
    try {
      const disk = await loadCachedDayPlan({ userId, locale: options.locale });
      if (disk && isDayPlanCurrent(disk)) {
        storePrefetchedDayPlan(disk);
        logRuntimeEvent("day_plan_prefetch", {
          source: "disk_cache",
          reason: options.reason ?? "ensure",
        });
      }
      const plan = await loadDayPlan();
      storePrefetchedDayPlan(plan);
      logRuntimeEvent("day_plan_prefetch", {
        source: "network",
        reason: options.reason ?? "ensure",
        currentLocalDate: plan.currentLocalDate,
      });
    } catch (error) {
      logRuntimeEvent("day_plan_prefetch_failed", {
        reason: options.reason ?? "ensure",
        message: error instanceof Error ? error.message : String(error),
      });
      console.warn("[DayPlanPrefetch] Failed", error);
    } finally {
      if (inFlightKey === key) {
        inFlightKey = null;
        inFlight = null;
      }
    }
  })();
}

/** True when a current plan is already on the prefetch bus (instant Day paint). */
export function hasCurrentPrefetchedDayPlan(): boolean {
  const plan = peekPrefetchedDayPlan();
  return Boolean(plan && isDayPlanCurrent(plan));
}
