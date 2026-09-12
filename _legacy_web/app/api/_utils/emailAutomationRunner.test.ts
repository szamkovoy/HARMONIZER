import { describe, expect, it } from "vitest";

import {
  SEND_MAX_ATTEMPTS,
  SEND_RETRY_DELAY_MS,
  isAfterActivation,
  shiftedNextStepIso,
} from "./emailAutomationRunner";

describe("isAfterActivation", () => {
  it("rejects events before activation (pause window is not backfilled)", () => {
    const activated = "2026-09-11T18:28:50.843+00:00";
    expect(isAfterActivation(Date.parse("2026-09-11T17:00:00.000Z"), activated)).toBe(false);
  });

  it("accepts events at or after activation", () => {
    const activated = "2026-09-11T18:28:50.843+00:00";
    expect(isAfterActivation(Date.parse("2026-09-11T18:28:50.843Z"), activated)).toBe(true);
    expect(isAfterActivation(Date.parse("2026-09-12T06:15:47.405Z"), activated)).toBe(true);
  });

  it("rejects when the chain has never been activated", () => {
    expect(isAfterActivation(Date.now(), null)).toBe(false);
    expect(isAfterActivation(Date.now(), undefined)).toBe(false);
  });
});

describe("send retry policy", () => {
  it("retries failed sends for several minutes instead of skipping the letter", () => {
    expect(SEND_RETRY_DELAY_MS).toBe(5 * 60_000);
    expect(SEND_MAX_ATTEMPTS).toBe(5);
  });
});

describe("shiftedNextStepIso", () => {
  it("keeps the remaining wait after a long pause", () => {
    const nextStep = "2026-09-15T12:00:00.000Z";
    const pausedAt = "2026-09-12T12:00:00.000Z";
    const resumedAt = Date.parse("2026-09-19T12:00:00.000Z");
    expect(shiftedNextStepIso(nextStep, pausedAt, resumedAt)).toBe("2026-09-22T12:00:00.000Z");
  });

  it("does not send an already-due letter earlier than it was due", () => {
    const nextStep = "2026-09-12T10:00:00.000Z";
    const pausedAt = "2026-09-12T12:00:00.000Z";
    const resumedAt = Date.parse("2026-09-19T12:00:00.000Z");
    expect(shiftedNextStepIso(nextStep, pausedAt, resumedAt)).toBe("2026-09-19T10:00:00.000Z");
  });

  it("does not rewind the clock if resume is stamped before pause", () => {
    const nextStep = "2026-09-15T12:00:00.000Z";
    const pausedAt = "2026-09-12T12:00:00.000Z";
    expect(shiftedNextStepIso(nextStep, pausedAt, Date.parse("2026-09-12T11:00:00.000Z"))).toBe(
      nextStep,
    );
  });
});
