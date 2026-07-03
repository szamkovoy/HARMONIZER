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

    // 14 s gap (beyond the 12 s interpolation budget → hard loss), then resume with a first
    // bogus-looking long RR then clean ~69 bpm (RR 870ms).
    const gapEnd = preGap[preGap.length - 1]!; // ~14070
    // First post-gap beat lands ~14s later; the very next interval is a bogus long one (1030ms → 58bpm).
    const resume1 = gapEnd + 14_000;
    const resume2 = resume1 + 1_030; // bogus 58 bpm interval
    const cleanTrain = beatTrain(resume2, 12, 870); // real ~69 bpm
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

  it("suppresses a post-gap bogus-long-RR spike (73 → 53 bpm after a finger lift)", () => {
    const engine = new PulseBpmEngine();
    // Stable ~73 bpm (RR 822ms) for 15 s.
    const stable = beatTrain(0, 18, 822);
    let last = { bpm: 0, reacquiring: false };
    for (const b of stable) {
      const snap = engine.push({
        timestampMs: b,
        mergedBeats: stable.filter((x) => x <= b),
        sourceKind: "fingerCamera",
      });
      last = { bpm: snap.bpm, reacquiring: snap.reacquiring };
    }
    const stableBpm = last.bpm;
    expect(stableBpm).toBeGreaterThan(70);
    expect(stableBpm).toBeLessThan(76);

    // 3 s finger lift → gap > 2.5 s. On return the post-gap RR are artifactual long
    // (~1063 ms → 56 bpm) because the peak detector re-locks against a stale beat. The
    // gap-reacquire count gate (POST_GAP_MIN_RR = 5) clears once 5 post-gap RR accumulate, but
    // those RR are bogus; without the drift guard they would pull displayBpm down to ~53. The
    // drift guard must keep holding the pre-gap BPM until post-gap RR return within ±25 % of the
    // stable baseline.
    const gapEnd = stable[stable.length - 1]!;
    const resume = [
      gapEnd + 3_000,
      gapEnd + 4_063,
      gapEnd + 5_126,
      gapEnd + 6_189,
      gapEnd + 7_009,
      gapEnd + 8_072,
      gapEnd + 9_135,
    ];
    const allBeats = [...stable, ...resume];
    let drifted = { bpm: 0, reacquiring: false };
    for (const b of resume) {
      const snap = engine.push({
        timestampMs: b + 10,
        mergedBeats: allBeats.filter((x) => x <= b + 10),
        sourceKind: "fingerCamera",
      });
      drifted = { bpm: snap.bpm, reacquiring: snap.reacquiring };
    }
    expect(drifted.bpm).toBeGreaterThan(stableBpm - 5); // held near 73, not pulled to 53
  });

  it("suppresses a post-gap short-first-RR leading spike (70 → 73 → 70 on the chart)", () => {
    const engine = new PulseBpmEngine();
    // Stable ~70 bpm (RR 857ms) for 15 s.
    const stable = beatTrain(0, 18, 857);
    let last = { bpm: 0, reacquiring: false };
    for (const b of stable) {
      const snap = engine.push({
        timestampMs: b,
        mergedBeats: stable.filter((x) => x <= b),
        sourceKind: "fingerCamera",
      });
      last = { bpm: snap.bpm, reacquiring: snap.reacquiring };
    }
    const stableBpm = last.bpm;
    expect(stableBpm).toBeGreaterThan(67);
    expect(stableBpm).toBeLessThan(73);

    // 3 s finger lift → gap > 2.5 s. On return the first two post-gap RR are artifactualy short
    // (~822 ms → 73 bpm) because the zero-phase bandpass rings on the dropSamplesSince
    // discontinuity and the peak detector catches the first peak slightly early. With
    // POST_GAP_MIN_RR = 5 the gate must keep holding the pre-gap ~70 bpm until enough true RR
    // (857 ms) accumulate, so the first PUBLISHED bpm is ~70 — no 73 leading spike.
    const gapEnd = stable[stable.length - 1]!;
    const resume = [
      gapEnd + 3_000,
      gapEnd + 3_822, // short artifactual RR (822 ms → 73 bpm)
      gapEnd + 4_644, // short artifactual RR (822 ms → 73 bpm)
      gapEnd + 5_501, // true RR (857 ms → 70 bpm)
      gapEnd + 6_358, // true RR (857 ms → 70 bpm)
      gapEnd + 7_215, // true RR (857 ms → 70 bpm)
    ];
    const allBeats = [...stable, ...resume];
    let released = { bpm: 0, reacquiring: true };
    for (const b of resume) {
      const snap = engine.push({
        timestampMs: b + 10,
        mergedBeats: allBeats.filter((x) => x <= b + 10),
        sourceKind: "fingerCamera",
      });
      released = { bpm: snap.bpm, reacquiring: snap.reacquiring };
    }
    expect(released.reacquiring).toBe(false);
    // The first published bpm after the gate clears must NOT be the 73 spike — it should sit
    // near the true ~70, within ±2 bpm of the pre-gap stable value.
    expect(Math.abs(released.bpm - stableBpm)).toBeLessThan(2.5);
    expect(released.bpm).toBeLessThan(72);
  });

  it("anchors BPM to baseline during a bridged gap (no post-gap edge spike)", () => {
    // Field scenario (export 1783093877906, 130 s lift): pre-gap ~71.6 bpm (RR 838 ms),
    // 3 s finger lift, then post-gap beats with artifactualy short RR (~713 ms → 84 bpm) from
    // bandpass ring/motion on finger return. The bridge flag stays true while the gap is in the
    // 10 s window; without anchoring, the mixed median (synthetic 838 + real 713) let the real
    // short RR pull BPM up to ~84 — a sharp edge spike on the chart. During bridging the
    // candidate MUST be anchored to stableRr so BPM holds at the pre-gap baseline until the gap
    // ages out of the window and the (now settled) real beats take over.
    const engine = new PulseBpmEngine();
    const stable = beatTrain(0, 18, 838); // ~71.6 bpm
    let stableSnap = { bpm: 0, reacquiring: false };
    for (const b of stable) {
      const snap = engine.push({
        timestampMs: b,
        mergedBeats: stable.filter((x) => x <= b),
        sourceKind: "fingerCamera",
      });
      stableSnap = { bpm: snap.bpm, reacquiring: snap.reacquiring };
    }
    const stableBpm = stableSnap.bpm;
    expect(stableBpm).toBeGreaterThan(69);
    expect(stableBpm).toBeLessThan(74);

    const gapEnd = stable[stable.length - 1]!;
    // 3 s lift, then post-gap beats at artifactual short RR 713 ms (→ ~84 bpm).
    const resume = [
      gapEnd + 3_000,
      gapEnd + 3_713,
      gapEnd + 4_426,
      gapEnd + 5_139,
      gapEnd + 5_852,
      gapEnd + 6_565,
    ];
    const allBeats = [...stable, ...resume];
    let maxBpmDuringBridge = stableBpm;
    for (const b of resume) {
      const snap = engine.push({
        timestampMs: b + 10,
        mergedBeats: allBeats.filter((x) => x <= b + 10),
        sourceKind: "fingerCamera",
      });
      // While the gap is still in the 10 s window the engine must be bridging (not reacquiring)
      // and BPM must stay anchored near the pre-gap baseline — no ~84 spike.
      if (snap.bridgingShortGap) {
        maxBpmDuringBridge = Math.max(maxBpmDuringBridge, snap.bpm);
        expect(snap.reacquiring).toBe(false);
      }
    }
    expect(maxBpmDuringBridge).toBeLessThan(stableBpm + 4); // no +13 bpm edge spike
  });

  it("treats a short 3-second finger lift as interpolable instead of hard reacquire", () => {
    const engine = new PulseBpmEngine();
    const stable = beatTrain(0, 18, 900); // ~66.7 bpm
    let stableSnap = { bpm: 0, reacquiring: false };
    for (const b of stable) {
      const snap = engine.push({
        timestampMs: b,
        mergedBeats: stable.filter((x) => x <= b),
        sourceKind: "fingerCamera",
      });
      stableSnap = { bpm: snap.bpm, reacquiring: snap.reacquiring };
    }
    expect(stableSnap.bpm).toBeGreaterThan(64);
    expect(stableSnap.bpm).toBeLessThan(69);

    const gapEnd = stable[stable.length - 1]!;
    const resumed = [
      gapEnd + 3_550,
      gapEnd + 4_450,
      gapEnd + 5_350,
    ];
    const allBeats = [...stable, ...resumed];
    const firstAfterReturn = engine.push({
      timestampMs: resumed[0]! + 10,
      mergedBeats: allBeats.filter((x) => x <= resumed[0]! + 10),
      sourceKind: "fingerCamera",
    });
    expect(firstAfterReturn.reacquiring).toBe(false);
    expect(firstAfterReturn.bridgingShortGap).toBe(true);
    expect(firstAfterReturn.bpm).toBeCloseTo(stableSnap.bpm, 1);
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
