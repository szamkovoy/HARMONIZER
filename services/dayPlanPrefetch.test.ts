import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loadDayPlanMock, loadCachedDayPlanMock, isDayPlanCurrentMock } = vi.hoisted(() => ({
  loadDayPlanMock: vi.fn(),
  loadCachedDayPlanMock: vi.fn(async () => null),
  isDayPlanCurrentMock: vi.fn(() => true),
}));

vi.mock("@/services/dayPlan", () => ({ loadDayPlan: loadDayPlanMock }));
vi.mock("@/services/dayPlanCache", () => ({
  loadCachedDayPlan: loadCachedDayPlanMock,
  isDayPlanCurrent: isDayPlanCurrentMock,
}));
vi.mock("@/services/runtimeDiagnostics", () => ({ logRuntimeEvent: vi.fn() }));

import {
  DAY_PLAN_PREFETCH_MIN_INTERVAL_MS,
  __resetDayPlanPrefetchForTests,
  ensureDayPlanPrefetch,
} from "./dayPlanPrefetch";
import { clearPrefetchedDayPlan } from "./dayPlanReloadRequest";

const plan = { currentLocalDate: "2026-09-14" } as never;

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ensureDayPlanPrefetch", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    __resetDayPlanPrefetchForTests();
    clearPrefetchedDayPlan();
    loadDayPlanMock.mockReset();
    loadDayPlanMock.mockResolvedValue(plan);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips back-to-back launch triggers once a network prefetch just completed", async () => {
    ensureDayPlanPrefetch({ userId: "u1", locale: "ru", reason: "tabs_mount" });
    await flush();
    expect(loadDayPlanMock).toHaveBeenCalledTimes(1);

    // Home `ready` → `stale_ready` → `ready` re-fires the effect within seconds.
    ensureDayPlanPrefetch({ userId: "u1", locale: "ru", reason: "home_ready" });
    ensureDayPlanPrefetch({ userId: "u1", locale: "ru", reason: "home_ready" });
    await flush();
    expect(loadDayPlanMock).toHaveBeenCalledTimes(1);
  });

  it("refetches after the min interval, for another user/locale, and on force", async () => {
    ensureDayPlanPrefetch({ userId: "u1", locale: "ru" });
    await flush();
    expect(loadDayPlanMock).toHaveBeenCalledTimes(1);

    ensureDayPlanPrefetch({ userId: "u1", locale: "en" });
    await flush();
    expect(loadDayPlanMock).toHaveBeenCalledTimes(2);

    ensureDayPlanPrefetch({ userId: "u1", locale: "en", force: true, reason: "after_practice" });
    await flush();
    expect(loadDayPlanMock).toHaveBeenCalledTimes(3);

    vi.setSystemTime(Date.now() + DAY_PLAN_PREFETCH_MIN_INTERVAL_MS + 1);
    ensureDayPlanPrefetch({ userId: "u1", locale: "en" });
    await flush();
    expect(loadDayPlanMock).toHaveBeenCalledTimes(4);
  });
});
