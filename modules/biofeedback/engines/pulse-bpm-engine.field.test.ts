import { describe, expect, it } from "vitest";
import {
  PulseBpmEngine,
  reconstructOpticalBeatWindow,
} from "@/modules/biofeedback/engines/pulse-bpm-engine";

/**
 * Field-representative scenarios reconstructed from the 5-minute finger-PPG session
 * (`breath-coherence-export-1783079328709.json`): a stable ~62–65 bpm pulse with a brief
 * start-of-session detector hiccup, three ~3 s finger lifts (t≈100/130/160 s) and one long
 * ~20 s lift (t≈200 s). These assert the optical model:
 *   - short gaps (open or closed) are interpolated → pulse stays live and smooth, no BPM spike;
 *   - the long gap falls through to reacquire (→ emulated at the screen level);
 *   - no boundary spike on the way in or out of a gap.
 */

/** Feed a beat train into the engine at ~4 Hz frames, return per-frame snapshots. */
function runEngine(
  beats: readonly number[],
  totalMs: number,
  opts?: { frameMs?: number; startMs?: number },
) {
  const engine = new PulseBpmEngine();
  const frameMs = opts?.frameMs ?? 250;
  const startMs = opts?.startMs ?? 0;
  const snaps: Array<{
    tMs: number;
    bpm: number;
    reacquiring: boolean;
    bridging: boolean;
    lockLive: boolean;
  }> = [];
  for (let t = startMs; t <= totalMs; t += frameMs) {
    const merged = beats.filter((b) => b <= t);
    const snap = engine.push({ timestampMs: t, mergedBeats: merged, sourceKind: "fingerCamera" });
    // Pipeline-equivalent "usable live window" gate.
    const lockLive =
      snap.bridgingShortGap === true ||
      (snap.reacquiring !== true && snap.rrCount >= 4 && snap.medianRrMs > 0);
    snaps.push({
      tMs: t,
      bpm: snap.bpm,
      reacquiring: snap.reacquiring,
      bridging: snap.bridgingShortGap,
      lockLive,
    });
  }
  return snaps;
}

/** Beats at a fixed rate across [startMs, endMs). */
function beatsAtRate(startMs: number, endMs: number, rrMs: number): number[] {
  const out: number[] = [];
  for (let t = startMs; t < endMs; t += rrMs) out.push(t);
  return out;
}

describe("PulseBpmEngine optical field scenarios", () => {
  it("interpolates a 3 s finger lift with no BPM spike and no lost-pulse frames", () => {
    const rr = 950; // ~63 bpm
    // 40 s stable, 3 s gap (beats absent), 40 s stable again.
    const pre = beatsAtRate(0, 40_000, rr);
    const post = beatsAtRate(43_000, 90_000, rr);
    const beats = [...pre, ...post];

    const snaps = runEngine(beats, 90_000);

    // Warm-up: ignore the first 8 s while the window fills.
    const settled = snaps.filter((s) => s.tMs >= 8_000);
    for (const s of settled) {
      // Pulse never collapses to 0 and never spikes far from the true ~63 bpm.
      expect(s.bpm).toBeGreaterThan(58);
      expect(s.bpm).toBeLessThan(70);
      // The window stays usable for tracking across the whole gap (no gray band).
      expect(s.lockLive).toBe(true);
      // A short lift must never trigger a hard reacquire.
      expect(s.reacquiring).toBe(false);
    }
  });

  it("bridges the open gap during re-lock (finger back but detector still catching up)", () => {
    const rr = 950;
    const pre = beatsAtRate(0, 40_000, rr);
    // Finger lifted at 40 s, back at 43 s, but the detector only emits beats again at 45.5 s
    // (2.5 s re-lock). The bridge must cover the whole silent stretch.
    const post = beatsAtRate(45_500, 90_000, rr);
    const beats = [...pre, ...post];
    const snaps = runEngine(beats, 90_000);

    const duringRelock = snaps.filter((s) => s.tMs >= 41_000 && s.tMs <= 45_000);
    expect(duringRelock.length).toBeGreaterThan(0);
    for (const s of duringRelock) {
      expect(s.lockLive).toBe(true);
      expect(s.reacquiring).toBe(false);
      expect(s.bpm).toBeGreaterThan(58);
      expect(s.bpm).toBeLessThan(70);
    }
  });

  it("does not spike BPM at the leading/trailing edge of a gap", () => {
    const rr = 950;
    const pre = beatsAtRate(0, 40_000, rr);
    // A single artifactual short RR right at the resume boundary (detector ringing).
    const post = [42_800, 43_450, ...beatsAtRate(44_400, 90_000, rr)];
    const beats = [...pre, ...post];
    const snaps = runEngine(beats, 90_000);

    const nearBoundary = snaps.filter((s) => s.tMs >= 40_000 && s.tMs <= 48_000);
    for (const s of nearBoundary) {
      // No spike toward the ~92 bpm that a raw 650 ms straddle RR would produce.
      expect(s.bpm).toBeLessThan(72);
      expect(s.bpm).toBeGreaterThan(56);
    }
  });

  it("falls through to reacquire on a 20 s loss", () => {
    const rr = 950;
    const pre = beatsAtRate(0, 40_000, rr);
    const post = beatsAtRate(60_000, 110_000, rr);
    const beats = [...pre, ...post];
    const snaps = runEngine(beats, 110_000);

    // Somewhere deep inside the 20 s gap the engine must have stopped bridging and be reacquiring.
    // Bridge budget is 12 s, so reacquiring starts ~12 s into the gap (t ≈ 52 s); check 54–58 s.
    const deepInGap = snaps.filter((s) => s.tMs >= 54_000 && s.tMs <= 58_000);
    expect(deepInGap.some((s) => s.reacquiring === true)).toBe(true);
    expect(deepInGap.every((s) => s.bridging === false)).toBe(true);
  });

  it("start-of-session detector hiccup (finger on) stays bridged, no gray band", () => {
    const rr = 950;
    // Stable, then a ~2.5 s detector dropout at ~17 s (finger firmly on), then stable.
    const beats = [
      ...beatsAtRate(0, 17_000, rr),
      ...beatsAtRate(19_500, 60_000, rr),
    ];
    const snaps = runEngine(beats, 60_000);
    const duringHiccup = snaps.filter((s) => s.tMs >= 17_500 && s.tMs <= 19_400);
    expect(duringHiccup.length).toBeGreaterThan(0);
    for (const s of duringHiccup) {
      expect(s.lockLive).toBe(true);
      expect(s.reacquiring).toBe(false);
    }
  });

  it("empty-window rescue: bridges a short gap even when the RR filter rejected the whole marginal window", () => {
    // Field scenario (export 1783088279299): marginal-PPG start tracked ~9 s, then the
    // peak detector lost lock; the RR filter over-rejected the erratic residual beats so
    // `acceptedBeats` was empty in the window, `lastBeat` was null and the open-tail bridge
    // never fired — a short loss painted a gray band even though a coherent baseline RR
    // was known. Simulate: stable beats 0..7 s, then NO accepted beats (feed none), but
    // supply the pipeline coherent baseline + last-trusted-beat anchor. The engine must
    // synthesize a bridge on the baseline RR for the budget window and stay live.
    const rr = 720; // ~83 bpm
    const pre = beatsAtRate(0, 7_000, rr);
    const engine = new PulseBpmEngine();
    // First, establish the coherent baseline in the engine by running the stable prefix.
    for (let t = 0; t <= 7_000; t += 250) {
      engine.push({
        timestampMs: t,
        mergedBeats: pre.filter((b) => b <= t),
        sourceKind: "fingerCamera",
        pipelineStableRrMs: rr,
        lastTrustedBeatTs: 7_000,
      });
    }
    // Now the gap: feed NO new beats (acceptedBeats will empty as the window slides past
    // the prefix). Pipeline still reports the coherent baseline + trusted anchor.
    const rescue: Array<{ tMs: number; bridging: boolean; reacquiring: boolean; bpm: number; lockLive: boolean }> = [];
    for (let t = 7_250; t <= 14_000; t += 250) {
      const snap = engine.push({
        timestampMs: t,
        mergedBeats: pre.filter((b) => b <= t),
        sourceKind: "fingerCamera",
        pipelineStableRrMs: rr,
        lastTrustedBeatTs: 7_000,
      });
      const lockLive =
        snap.bridgingShortGap === true ||
        (snap.reacquiring !== true && snap.rrCount >= 4 && snap.medianRrMs > 0);
      rescue.push({ tMs: t, bridging: snap.bridgingShortGap, reacquiring: snap.reacquiring, bpm: snap.bpm, lockLive });
    }
    // The first ~8 s after the trusted anchor must stay bridged and live (no gray band).
    const shortGap = rescue.filter((s) => s.tMs <= 15_000);
    expect(shortGap.some((s) => s.bridging === true)).toBe(true);
    for (const s of shortGap) {
      expect(s.lockLive).toBe(true);
      expect(s.reacquiring).toBe(false);
      expect(s.bpm).toBeGreaterThan(70);
      expect(s.bpm).toBeLessThan(95);
    }
  });
});

describe("reconstructOpticalBeatWindow", () => {
  it("fills a short closed gap with evenly spaced synthetic beats", () => {
    const rr = 950;
    const beats = [...beatsAtRate(0, 10_000, rr)];
    // Introduce a ~3 s hole.
    const withGap = beats.filter((b) => b < 5_000 || b > 8_000);
    const res = reconstructOpticalBeatWindow(withGap, 10_000, rr, 12_000);
    // The reconstructed intervals should be close to rr everywhere (no giant straddle RR).
    const rrs: number[] = [];
    for (let i = 1; i < res.beats.length; i += 1) rrs.push(res.beats[i]! - res.beats[i - 1]!);
    expect(Math.max(...rrs)).toBeLessThan(rr * 1.6);
    expect(res.bridging).toBe(true);
    expect(res.reacquiring).toBe(false);
  });

  it("marks a long open gap as reacquiring", () => {
    const rr = 950;
    const beats = beatsAtRate(0, 30_000, rr);
    const res = reconstructOpticalBeatWindow(beats, 45_000, rr, 12_000);
    expect(res.reacquiring).toBe(true);
    expect(res.bridging).toBe(false);
  });
});
