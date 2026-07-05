import { describe, expect, it } from "vitest";

import type { PlannedCycle } from "@/modules/breath/core/breath-phase-planner";
import {
  SCHUMANN_RESONANCE_HZ,
  buildMandalaSoundFrame,
  computeBreathSync,
  computePulseSync,
  detectGongCrossing,
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

  it("fires gongs only at the two intended frequency crossings", () => {
    // 7.83 Гц (резонанс Шумана, альфа→тета) → средний гонг.
    expect(detectGongCrossing(8.0, 7.8)).toBe("theta");
    expect(detectGongCrossing(SCHUMANN_RESONANCE_HZ, SCHUMANN_RESONANCE_HZ - 0.01)).toBe("theta");
    // 4 Гц (тета→дельта) → большой гонг.
    expect(detectGongCrossing(4.1, 3.9)).toBe("delta");
    // Без перехода порога — гонга нет.
    expect(detectGongCrossing(9.0, 8.5)).toBeNull();
    expect(detectGongCrossing(6.0, 5.0)).toBeNull();
    expect(detectGongCrossing(3.0, 2.5)).toBeNull();
  });

  it("does not fire a gong on the very first frame of a session", () => {
    expect(detectGongCrossing(null, 12)).toBeNull();
    expect(detectGongCrossing(null, 6)).toBeNull();
  });

  it("builds a low-gain frame for the audio engine", () => {
    const frame = buildMandalaSoundFrame({
      startedAtMs: 0,
      nowMs: 2_000,
      durationMs: 20 * 60_000,
      plannedCycle: cycle,
      cycleStartMs: 0,
      previousTargetHz: null,
    });

    expect(frame.textureGain).toBeGreaterThan(0);
    expect(frame.textureGain).toBeLessThan(0.14);
    expect(frame.binauralGain).toBeGreaterThan(0.03);
    expect(frame.binauralGain).toBeLessThan(0.06);
    expect(frame.flickerIntensity).toBeLessThan(0.35);
  });

  it("emits exactly two gongs on a 20-min session (Schumann + theta→delta)", () => {
    const durationMs = 20 * 60_000;
    const tickMs = 250;
    let previousHz: number | null = null;
    const gongs: Array<{ atMs: number; kind: string }> = [];

    for (let t = 0; t <= durationMs; t += tickMs) {
      const frame = buildMandalaSoundFrame({
        startedAtMs: 0,
        nowMs: t,
        durationMs,
        plannedCycle: cycle,
        cycleStartMs: 0,
        previousTargetHz: previousHz,
      });
      if (frame.gongTrigger) {
        gongs.push({ atMs: t, kind: frame.gongTrigger });
      }
      previousHz = frame.targetHz;
    }

    expect(gongs).toHaveLength(2);
    expect(gongs[0]!.kind).toBe("theta"); // пересечение 7.83 Гц
    expect(gongs[1]!.kind).toBe("delta"); // пересечение 4 Гц
    // Первый гонг — в первой половине, второй — во второй.
    expect(gongs[0]!.atMs).toBeLessThan(gongs[1]!.atMs);
  });

  it("emits no gong on a 3-min session that stays in alpha", () => {
    // 3 мин → f_end = 8 Гц, f(T) ≈ 8.08 — не опускается ниже 7.83 Гц.
    const durationMs = 3 * 60_000;
    const tickMs = 250;
    let previousHz: number | null = null;
    let gongCount = 0;

    for (let t = 0; t <= durationMs; t += tickMs) {
      const frame = buildMandalaSoundFrame({
        startedAtMs: 0,
        nowMs: t,
        durationMs,
        previousTargetHz: previousHz,
      });
      if (frame.gongTrigger) gongCount += 1;
      previousHz = frame.targetHz;
    }

    expect(gongCount).toBe(0);
  });
});
