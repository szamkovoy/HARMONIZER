import { describe, expect, it } from "vitest";
import { PulseBpmEngine } from "@/modules/biofeedback/engines/pulse-bpm-engine";

/** Build a beat train: `count` beats spaced by `rrMs` starting at `startMs`. */
function beatTrain(startMs: number, count: number, rrMs: number): number[] {
  const beats: number[] = [];
  let t = startMs;
  for (let i = 0; i < count; i += 1) {
    beats.push(t);
    t += rrMs;
  }
  return beats;
}

describe("PulseBpmEngine post-gap reacquire gate (fingerCamera)", () => {
  it("withholds the bogus first BPM right after a gap, then resumes clean", () => {
    const engine = new PulseBpmEngine();
    // Stable ~64 bpm (RR 938ms) for 15 s.
    const preGap = beatTrain(0, 16, 938);
    let last = { bpm: 0, reacquiring: false };
    for (const b of preGap) {
      const snap = engine.push({ timestampMs: b, mergedBeats: preGap.filter((x) => x <= b), sourceKind: "fingerCamera" });
      last = { bpm: snap.bpm, reacquiring: snap.reacquiring };
    }
    const stableBpm = last.bpm;
    expect(stableBpm).toBeGreaterThan(60);
    expect(stableBpm).toBeLessThan(68);

    // 8 s gap, then resume with a first bogus-looking long RR then clean ~69 bpm (RR 870ms).
    const gapEnd = preGap[preGap.length - 1]!; // ~14070
    // First post-gap beat lands ~8s later; the very next interval is a bogus long one (1030ms → 58bpm).
    const resume1 = gapEnd + 8_000;
    const resume2 = resume1 + 1_030; // bogus 58 bpm interval
    const cleanTrain = beatTrain(resume2, 6, 870); // real ~69 bpm
    const postBeats = [resume1, ...cleanTrain];
    const allBeats = [...preGap, ...postBeats];

    // Frame right after the first two post-gap beats (only 1 post-gap RR) → must be reacquiring,
    // must NOT report the bogus 58, holds the pre-gap value instead.
    const early = engine.push({
      timestampMs: resume2 + 10,
      mergedBeats: allBeats.filter((x) => x <= resume2 + 10),
      sourceKind: "fingerCamera",
    });
    expect(early.reacquiring).toBe(true);
    expect(early.bpm).toBeCloseTo(stableBpm, 1); // held, not 58

    // After enough clean post-gap RRs the gate clears and BPM reflects the real ~69.
    let final = { bpm: 0, reacquiring: true };
    for (const b of cleanTrain) {
      const snap = engine.push({
        timestampMs: b + 10,
        mergedBeats: allBeats.filter((x) => x <= b + 10),
        sourceKind: "fingerCamera",
      });
      final = { bpm: snap.bpm, reacquiring: snap.reacquiring };
    }
    expect(final.reacquiring).toBe(false);
    expect(final.bpm).toBeGreaterThan(66);
    expect(final.bpm).toBeLessThan(72);
  });

  it("does not gate wearable RR (chest strap RR is trusted)", () => {
    const engine = new PulseBpmEngine();
    const beats = [0, 900, 1_800, 12_000, 12_850]; // 8s+ gap in the middle
    const snap = engine.push({
      timestampMs: 12_860,
      mergedBeats: beats,
      sourceKind: "wearable",
    });
    expect(snap.reacquiring).toBe(false);
  });
});
