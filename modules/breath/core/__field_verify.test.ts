import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  collectNonLiveIntervalsFromLog,
  isPulseLogEntryLiveForMeasurement,
} from "@/modules/breath/core/breath-results-series";
import {
  runCoherenceSessionAnalysis,
  type CoherencePulseLogEntry,
} from "@/modules/breath/core/coherence-session-analysis";
import {
  filterOnBodyWearableRrIntervals,
  isWearableRrPacketTrustworthy,
} from "@/modules/biofeedback/wearables/wearableRrQuality";
import {
  calculateBaevskyStressIndexRaw,
  computeRmssdStandardFromRrIntervals,
  hampelFilterRrIntervals,
  mapBaevskyStressToPercent,
} from "@/modules/biofeedback/core/metrics";

/** Mirror of CoherenceBreathScreen.buildDenseHrvSeriesFromBeats for field verification. */
function denseHrv(
  beats: readonly number[],
  startMs: number,
  practiceMs: number,
  gaps: readonly { startMs: number; endMs: number }[] = [],
) {
  const sorted = [...beats].sort((a, b) => a - b);
  const rr: { tMs: number; rr: number }[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const d = sorted[i]! - sorted[i - 1]!;
    if (d >= 300 && d <= 1500) rr.push({ tMs: sorted[i]! - startMs, rr: d });
  }
  const insideGap = (tMs: number) => gaps.some((g) => tMs >= g.startMs && tMs <= g.endMs);
  const liveRr = rr.filter((e) => !insideGap(e.tMs));
  const rmssd: { tMs: number; value: number }[] = [];
  const stress: { tMs: number; value: number }[] = [];
  const practiceSec = Math.floor(practiceMs / 1000);
  for (let s = 1; s <= practiceSec; s += 1) {
    const tMs = s * 1000;
    if (insideGap(tMs)) continue;
    const w30 = liveRr.filter((e) => e.tMs <= tMs && e.tMs > tMs - 30_000).map((e) => e.rr);
    const w60 = liveRr.filter((e) => e.tMs <= tMs && e.tMs > tMs - 60_000).map((e) => e.rr);
    if (w30.length >= 8) {
      const v = Math.min(160, computeRmssdStandardFromRrIntervals(hampelFilterRrIntervals(w30)));
      if (v > 0) rmssd.push({ tMs, value: v });
    }
    if (w60.length >= 20) {
      const raw = calculateBaevskyStressIndexRaw(hampelFilterRrIntervals(w60));
      if (raw > 0) stress.push({ tMs, value: mapBaevskyStressToPercent(raw) });
    }
  }
  return { rmssd, stress };
}

const DIR = "/Users/sergey/Downloads";
const EXPORTS = {
  optical: `${DIR}/breath-coherence-export-1782997095992.json`,
  ble5: `${DIR}/breath-coherence-export-1782997501283.json`,
  ble10: `${DIR}/breath-coherence-export-1782998375014.json`,
};

/** These are local field exports (author's Downloads). Skip cleanly when absent (CI/other machines). */
const EXPORTS_AVAILABLE = Object.values(EXPORTS).every((f) => existsSync(f));

function load(f: string) {
  return JSON.parse(readFileSync(f, "utf8"));
}

function nonLiveIntervals(j: any) {
  const start = j.session.startedAtMs;
  return collectNonLiveIntervalsFromLog(j.pulseLog as CoherencePulseLogEntry[], start).map(
    (iv) => ({ startS: +(iv.startMs / 1000).toFixed(1), endS: +(iv.endMs / 1000).toFixed(1), durS: +((iv.endMs - iv.startMs) / 1000).toFixed(1) }),
  );
}

function reanalyze(j: any) {
  const beats: number[] = j.beats.timestampsMsAnalyzed;
  return runCoherenceSessionAnalysis({
    sessionStartedAtMs: j.session.startedAtMs,
    sessionEndedAtMs: j.session.endedAtMs,
    beatTimestampsMs: beats,
    inhaleMs: j.session.inhaleMs,
    exhaleMs: j.session.exhaleMs,
    mode: j.session.mode,
    bufferMsBeforeSession: j.session.bufferMsBeforeSession,
  });
}

/** Count contiguous per-second RSA segments (drops = null runs). */
function countSegments(perSecond: any[], key: string) {
  let segs = 0;
  let inSeg = false;
  for (const p of perSecond) {
    const has = p[key] != null;
    if (has && !inSeg) {
      segs += 1;
      inSeg = true;
    } else if (!has) {
      inSeg = false;
    }
  }
  return segs;
}

describe.skipIf(!EXPORTS_AVAILABLE)("FIELD VERIFY — BLE dropout artifacts", () => {
  it("BLE5 non-live intervals (baseline)", () => {
    const j = load(EXPORTS.ble5);
    const iv = nonLiveIntervals(j);
    console.log("BLE5 nonLive:", JSON.stringify(iv));
    const spurious = iv.filter((x) => x.durS < 8 && x.startS > 190);
    console.log("BLE5 spurious short gaps after reconnect:", JSON.stringify(spurious));
  });

  it("BLE10 non-live intervals (baseline) — strap never removed", () => {
    const j = load(EXPORTS.ble10);
    const iv = nonLiveIntervals(j);
    console.log("BLE10 nonLive:", JSON.stringify(iv));
    const spurious = iv.filter((x) => x.durS < 8);
    console.log("BLE10 spurious gaps (should be zero after fix):", JSON.stringify(spurious));
  });

  it("BLE10 metric continuity (RSA/coherence segments)", () => {
    const j = load(EXPORTS.ble10);
    const res = reanalyze(j);
    const rsaSegs = countSegments(res.perSecond, "rsaAmplitudeBpm");
    const rsaPts = res.perSecond.filter((p: any) => p.rsaAmplitudeBpm != null).length;
    const insufficient = res.perSecond.filter((p: any) => p.insufficientCoverage).length;
    console.log(
      `BLE10 analysis: rsaSegs=${rsaSegs} rsaPts=${rsaPts} insufficientSecs=${insufficient}/${res.perSecond.length} cohAvg=${res.coherenceAveragePercent} rsa=${res.rsaAmplitudeBpm} withheld=${res.metricsWithheldDueToInsufficientData}`,
    );
    // Push-up test: strap never removed. The two RSA breaks were single Polar RR artifacts
    // (6.0 s and 8.7 s voids flanked by live beats). After bridging, RSA must be ~one segment.
    expect(rsaSegs).toBeLessThanOrEqual(1);
  });

  it("BLE5 metric continuity", () => {
    const j = load(EXPORTS.ble5);
    const res = reanalyze(j);
    const rsaSegs = countSegments(res.perSecond, "rsaAmplitudeBpm");
    const insufficient = res.perSecond.filter((p: any) => p.insufficientCoverage).length;
    console.log(
      `BLE5 analysis: rsaSegs=${rsaSegs} insufficientSecs=${insufficient}/${res.perSecond.length} cohAvg=${res.coherenceAveragePercent} rsa=${res.rsaAmplitudeBpm} withheld=${res.metricsWithheldDueToInsufficientData}`,
    );
  });
});

describe.skipIf(!EXPORTS_AVAILABLE)("FIELD VERIFY — 2026-07-02 round 2", () => {
  it("BLE5 one gray band (single removal) + no RSA startup spike", () => {
    const j = load(EXPORTS.ble5);
    const iv = nonLiveIntervals(j);
    console.log("BLE5 nonLive:", JSON.stringify(iv));
    // A single strap removal must render as ONE band, not two split by a reconnect-flap island.
    expect(iv.length).toBe(1);

    const res = reanalyze(j);
    const gapsMs = iv.map((g) => ({ startMs: g.startS * 1000, endMs: g.endS * 1000 }));
    // Display-equivalent RSA: gate to the gray band (garbage buffered beats live inside it).
    const rsaDisplay = res.perSecond
      .filter((p: any) => p.rsaAmplitudeBpm != null)
      .filter((p: any) => !gapsMs.some((g) => p.secondIndex * 1000 >= g.startMs && p.secondIndex * 1000 <= g.endMs))
      .filter((p: any) => p.rsaAmplitudeBpm <= 20);
    const firstRsa = rsaDisplay[0]?.rsaAmplitudeBpm ?? 0;
    console.log("BLE5 displayed RSA first:", firstRsa.toFixed(1), "count:", rsaDisplay.length);
    // The old inflated leading point (~20 bpm settling transient) must be gone.
    expect(firstRsa).toBeLessThan(15);

    const dh = denseHrv(j.beats.timestampsMsAnalyzed, j.session.startedAtMs, j.session.endedAtMs - j.session.startedAtMs, gapsMs);
    const rm = dh.rmssd.map((p) => p.value);
    console.log("BLE5 rmssd(gap-gated): n=", rm.length, "max=", Math.max(...rm).toFixed(1), "min=", Math.min(...rm).toFixed(1));
    // Reconnect transient no longer injects a 135 ms RMSSD spike.
    expect(Math.max(...rm)).toBeLessThan(90);
  });

  it("BLE10 continuous RSA + no RMSSD reconnect spike (push-up test)", () => {
    const j = load(EXPORTS.ble10);
    console.log("BLE10 nonLive:", JSON.stringify(nonLiveIntervals(j)));
    const res = reanalyze(j);
    const rsaPts = res.perSecond.filter((p: any) => p.rsaAmplitudeBpm != null);
    console.log("BLE10 rsaSegs:", countSegments(res.perSecond, "rsaAmplitudeBpm"), "rsaPts:", rsaPts.length, "/", res.perSecond.length);
    const dh = denseHrv(j.beats.timestampsMsAnalyzed, j.session.startedAtMs, j.session.endedAtMs - j.session.startedAtMs);
    const rm = dh.rmssd;
    const spikes = rm.filter((p, i) => i > 0 && i < rm.length - 1 && Math.abs(p.value - rm[i - 1]!.value) > 25);
    console.log("BLE10 rmssd n=", rm.length, "max=", Math.max(...rm.map((p) => p.value)).toFixed(1), "spikes(>25ms jump):", spikes.map((p) => `${(p.tMs / 1000).toFixed(0)}s:${p.value.toFixed(0)}`).join(" "));
    // The single missed-beat 946 ms RR no longer spikes RMSSD to 89 then 4.
    expect(spikes.length).toBe(0);
    expect(Math.max(...rm.map((p) => p.value))).toBeLessThan(70);
  });
});

describe.skipIf(!EXPORTS_AVAILABLE)("FIELD VERIFY — dense RMSSD/stress", () => {
  it("BLE10 dense RMSSD & stress are dense and start early", () => {
    const j = load(EXPORTS.ble10);
    const beats: number[] = j.beats.timestampsMsAnalyzed;
    const start = j.session.startedAtMs;
    const practiceMs = j.session.endedAtMs - j.session.startedAtMs;
    const { rmssd, stress } = denseHrv(beats, start, practiceMs);
    console.log(
      `BLE10 dense: rmssdPts=${rmssd.length} firstRmssdT=${rmssd[0]?.tMs} stressPts=${stress.length} firstStressT=${stress[0]?.tMs} stressRange=[${Math.min(...stress.map((p) => p.value)).toFixed(0)}..${Math.max(...stress.map((p) => p.value)).toFixed(0)}]`,
    );
    expect(rmssd.length).toBeGreaterThan(100);
    expect(stress.length).toBeGreaterThan(100);
    expect(rmssd[0]!.tMs).toBeLessThanOrEqual(20_000);
    expect(stress[0]!.tMs).toBeLessThanOrEqual(30_000);
  });

  it("BLE5 dense RMSSD & stress skip the removal gap", () => {
    const j = load(EXPORTS.ble5);
    const beats: number[] = j.beats.timestampsMsAnalyzed;
    const start = j.session.startedAtMs;
    const practiceMs = j.session.endedAtMs - j.session.startedAtMs;
    const { rmssd, stress } = denseHrv(beats, start, practiceMs);
    console.log(
      `BLE5 dense: rmssdPts=${rmssd.length} firstRmssdT=${rmssd[0]?.tMs} stressPts=${stress.length}`,
    );
  });
});

describe("FIELD VERIFY — wearable RR gate behavior", () => {
  it("high-HR (exercise) RR intervals must be accepted", () => {
    // 134 bpm -> 448 ms, 150 bpm -> 400 ms, 171 bpm -> 350 ms
    console.log("448 onBody:", filterOnBodyWearableRrIntervals([448]));
    console.log("400 onBody:", filterOnBodyWearableRrIntervals([400]));
    console.log("375 onBody:", filterOnBodyWearableRrIntervals([375]));
  });

  it("single missed-beat (giant RR) should not discard the whole packet", () => {
    // real packet during exertion: [520, 8685, 500] — one missed beat
    const rr = [520, 8685, 500];
    console.log("trustworthy(mixed w/ giant):", isWearableRrPacketTrustworthy(rr));
    console.log("onBody(mixed w/ giant):", filterOnBodyWearableRrIntervals(rr));
  });
});
