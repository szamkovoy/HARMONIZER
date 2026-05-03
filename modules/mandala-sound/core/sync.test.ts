import { describe, expect, it } from "vitest";

import type { PlannedCycle } from "@/modules/breath/core/breath-phase-planner";
import {
  buildMandalaSoundFrame,
  computeBreathSync,
  computePulseSync,
  detectGongTransition,
} from "@/modules/mandala-sound/core/sync";

const cycle: PlannedCycle = {
  cycleMs: 10_000,
  baselineBpm: 60,
  rsaInfo: null,
  shape: {
    baseIndex: 0,
    phases: [
      { kind: "inhale", beats: 5 },
      { kind: "exhale", beats: 5 },
    ],
  },
  phases: [
    {
      kind: "inhale",
      beats: 5,
      startMsInCycle: 0,
      endMsInCycle: 5_000,
      phaseMs: 5_000,
      bpmForPhase: 60,
      channel: "both",
    },
    {
      kind: "exhale",
      beats: 5,
      startMsInCycle: 5_000,
      endMsInCycle: 10_000,
      phaseMs: 5_000,
      bpmForPhase: 60,
      channel: "both",
    },
  ],
};

describe("mandala sound sync", () => {
  it("derives breath phase from the planned breathing cycle", () => {
    expect(computeBreathSync(cycle, 1_000, 3_500).phase).toBeCloseTo(0.5, 2);
    expect(computeBreathSync(cycle, 1_000, 8_500).phase).toBeCloseTo(0.5, 2);
    expect(computeBreathSync(cycle, 1_000, 6_000).phaseKind).toBe("exhale");
  });

  it("uses detected beats before falling back to LFO", () => {
    const detected = computePulseSync({
      lastBeat: { timestampMs: 1_000, source: "detected", confidence: 0.9 },
      lastRrMs: 1_000,
      nowMs: 1_500,
    });
    const fallback = computePulseSync({
      lastBeat: { timestampMs: 1_000, source: "detected", confidence: 0.9 },
      lastRrMs: 1_000,
      nowMs: 4_000,
    });

    expect(detected.source).toBe("detected");
    expect(detected.phase).toBeCloseTo(0.5, 2);
    expect(fallback.source).toBe("fallback");
  });

  it("triggers gongs only when entering audio bands", () => {
    expect(detectGongTransition("beta", "alpha")).toBe("alpha");
    expect(detectGongTransition("alpha", "alpha")).toBeNull();
    expect(detectGongTransition("alpha", "theta")).toBe("theta");
    expect(detectGongTransition("theta", "delta")).toBe("delta");
  });

  it("builds a low-gain frame for the audio engine", () => {
    const frame = buildMandalaSoundFrame({
      startedAtMs: 0,
      nowMs: 2_000,
      durationMs: 20 * 60_000,
      plannedCycle: cycle,
      cycleStartMs: 0,
      previousBand: "beta",
    });

    expect(frame.textureGain).toBeGreaterThan(0);
    expect(frame.textureGain).toBeLessThan(0.14);
    expect(frame.flickerIntensity).toBeLessThan(0.2);
  });
});
