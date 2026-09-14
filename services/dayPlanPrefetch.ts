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
/** Bumped when a prior prefetch must not win (e.g. after practice clears cache). */
let prefetchGeneration = 0;
/** Last successful network prefetch per user+locale — see `DAY_PLAN_PREFETCH_MIN_INTERVAL_MS`. */
let lastNetworkPrefetch: { key: string; at: number } | null = null;

/**
 * `ensureDayPlanPrefetch` is triggered from several launch hooks (tabs mount, Home
 * `ready` → `stale_ready` → `ready`, locale settle). Each `/api/day` GET also writes
 * (purge + expire offers), so back-to-back repeats within this window are skipped —
 * observed as 3 identical DELETE/PATCH/GET chains within 13 s on cold start.
 */
export const DAY_PLAN_PREFETCH_MIN_INTERVAL_MS = 30_000;

function prefetchKey(userId: string, locale: AppLocale): string {
  return `${userId}:${locale}`;
}

/** True when a network prefetch for `key` completed less than the min interval ago. */
export function isDayPlanPrefetchFresh(key: string, now = Date.now()): boolean {
  return Boolean(
    lastNetworkPrefetch &&
      lastNetworkPrefetch.key === key &&
      now - lastNetworkPrefetch.at < DAY_PLAN_PREFETCH_MIN_INTERVAL_MS,
  );
}

/** Test-only reset of module state. */
export function __resetDayPlanPrefetchForTests(): void {
  inFlightKey = null;
  inFlight = null;
  prefetchGeneration = 0;
  lastNetworkPrefetch = null;
}

/** Fire-and-forget; dedupes concurrent calls for the same user+locale unless `force`. */
export function ensureDayPlanPrefetch(options: {
  userId: string;
  locale: AppLocale;
  reason?: string;
  /** Restart even if a prefetch is already in flight; discard results from the prior run. */
  force?: boolean;
}): void {
  const userId = options.userId.trim();
  if (!userId) return;
  const key = prefetchKey(userId, options.locale);

  if (options.force) {
    prefetchGeneration += 1;
    inFlightKey = null;
    inFlight = null;
    lastNetworkPrefetch = null;
  } else if (inFlight && inFlightKey === key) {
    return;
  } else if (isDayPlanPrefetchFresh(key) && hasCurrentPrefetchedDayPlan()) {
    logRuntimeEvent("day_plan_prefetch", { source: "recent", reason: options.reason ?? "ensure" }, "debug");
    return;
  }

  const generation = prefetchGeneration;
  inFlightKey = key;
  inFlight = (async () => {
    try {
      const disk = await loadCachedDayPlan({ userId, locale: options.locale });
      if (generation !== prefetchGeneration) return;
      if (disk && isDayPlanCurrent(disk)) {
        storePrefetchedDayPlan(disk);
        logRuntimeEvent("day_plan_prefetch", {
          source: "disk_cache",
          reason: options.reason ?? "ensure",
        });
      }
      const plan = await loadDayPlan();
      if (generation !== prefetchGeneration) return;
      storePrefetchedDayPlan(plan);
      lastNetworkPrefetch = { key, at: Date.now() };
      logRuntimeEvent("day_plan_prefetch", {
        source: "network",
        reason: options.reason ?? "ensure",
        currentLocalDate: plan.currentLocalDate,
      });
    } catch (error) {
      if (generation !== prefetchGeneration) return;
      logRuntimeEvent("day_plan_prefetch_failed", {
        reason: options.reason ?? "ensure",
        message: error instanceof Error ? error.message : String(error),
      });
      console.warn("[DayPlanPrefetch] Failed", error);
    } finally {
      if (generation === prefetchGeneration && inFlightKey === key) {
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
