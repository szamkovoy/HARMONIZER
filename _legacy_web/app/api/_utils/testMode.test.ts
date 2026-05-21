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
    const { sessionTtlMs, sessionResumeTtlMs } = await loadTestMode();
    expect(sessionTtlMs()).toBe(2 * 60 * 60 * 1000);
    expect(sessionResumeTtlMs()).toBe(12_000);
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
});
