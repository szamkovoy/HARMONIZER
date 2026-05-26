import { DateTime } from "luxon";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadTestMode() {
  vi.resetModules();
  return import("./testMode");
}

describe("testMode", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    process.env = { ...envBackup };
  });

  afterEach(() => {
    process.env = { ...envBackup };
    vi.resetModules();
  });

  it("hoursToMs(4) equals 4h when test mode is off", async () => {
    delete process.env.TEST_MODE_FAST_INTERVALS;
    const { hoursToMs } = await loadTestMode();
    expect(hoursToMs(4)).toBe(4 * 60 * 60 * 1000);
  });

  it("hoursToMs(4) equals 24s when test mode is on with divisor 600", async () => {
    process.env.TEST_MODE_FAST_INTERVALS = "1";
    process.env.TEST_MODE_TIME_DIVISOR = "600";
    const { hoursToMs } = await loadTestMode();
    expect(hoursToMs(4)).toBe(24_000);
  });

  it("sessionTtlMs stays at real 2h even in test mode", async () => {
    process.env.TEST_MODE_FAST_INTERVALS = "1";
    process.env.TEST_MODE_TIME_DIVISOR = "600";
    const { planningReconciliationDelayMs, sessionTtlMs, sessionResumeTtlMs } = await loadTestMode();
    expect(sessionTtlMs()).toBe(2 * 60 * 60 * 1000);
    expect(sessionResumeTtlMs()).toBe(12_000);
    expect(planningReconciliationDelayMs()).toBe(1_000);
  });

  it("forcedPhaseOrNull returns evening override", async () => {
    process.env.TEST_MODE_FORCE_PHASE = "evening";
    const { forcedPhaseOrNull } = await loadTestMode();
    expect(forcedPhaseOrNull()).toBe("evening");
  });

  it("forcedPhaseOrNull returns null for invalid phase", async () => {
    process.env.TEST_MODE_FORCE_PHASE = "night";
    const { forcedPhaseOrNull } = await loadTestMode();
    expect(forcedPhaseOrNull()).toBeNull();
  });

  it("phaseTimeFor returns evening when forced at local hour 10", async () => {
    process.env.TEST_MODE_FORCE_PHASE = "evening";
    vi.resetModules();
    const { phaseTimeFor } = await import("./dialogBranching");
    expect(phaseTimeFor(DateTime.fromISO("2026-05-21T10:00:00", { zone: "UTC" }))).toBe("evening");
  });

  it("promptLocalHour uses representative hour when phase is forced", async () => {
    process.env.TEST_MODE_FORCE_PHASE = "morning";
    const { promptLocalHour } = await loadTestMode();
    expect(promptLocalHour(22)).toBe(9);
  });

  it("promptLocalHour keeps real hour when phase is not forced", async () => {
    delete process.env.TEST_MODE_FORCE_PHASE;
    const { promptLocalHour } = await loadTestMode();
    expect(promptLocalHour(22)).toBe(22);
  });

  it("effectiveDialogNowLocal aligns the hour with forced phase", async () => {
    process.env.TEST_MODE_FORCE_PHASE = "day";
    const { effectiveDialogNowLocal } = await loadTestMode();
    const actual = DateTime.fromISO("2026-05-25T23:28:45", { zone: "Europe/Moscow" });

    expect(effectiveDialogNowLocal(actual).toFormat("yyyy-MM-dd HH:mm:ss")).toBe("2026-05-25 14:28:00");
  });
});
