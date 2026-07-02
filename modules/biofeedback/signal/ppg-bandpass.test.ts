import { describe, expect, it } from "vitest";

import { bandpassPpgForPeakDetection } from "@/modules/biofeedback/signal/ppg-bandpass";

/** Peaks in a zero-centered series (local maxima above 0), used as a beat-count proxy. */
function countPeaks(series: readonly number[]): number {
  let peaks = 0;
  for (let i = 1; i < series.length - 1; i += 1) {
    if (series[i]! > 0 && series[i]! >= series[i - 1]! && series[i]! > series[i + 1]!) {
      peaks += 1;
    }
  }
  return peaks;
}

function makePulse(fps: number, seconds: number, bpm: number): number[] {
  const hz = bpm / 60;
  const n = Math.round(fps * seconds);
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const t = i / fps;
    // Pulse fundamental + a slow baseline drift the bandpass should reject.
    out.push(Math.sin(2 * Math.PI * hz * t) + 0.6 * Math.sin(2 * Math.PI * 0.15 * t));
  }
  return out;
}

describe("ppg-bandpass matched filter across capture rates", () => {
  // 12 s of a 63 bpm pulse (1.05 Hz) → ~12.6 cycles → ~12–13 peaks after filtering.
  const bpm = 63;
  const seconds = 12;
  const expectedCycles = (bpm / 60) * seconds;

  for (const fps of [10, 12, 15, 30]) {
    it(`extracts the pulse at ${fps} Hz (matched SOS, not a mismatched bucket)`, () => {
      const raw = makePulse(fps, seconds, bpm);
      const filtered = bandpassPpgForPeakDetection(raw, fps);
      const peaks = countPeaks(filtered);
      // Peak count must track the real number of pulse cycles within ±2 — the regression was that a
      // 10 Hz stream got the 15-Hz-designed filter, mangling the waveform and dropping/adding peaks.
      expect(peaks).toBeGreaterThanOrEqual(Math.round(expectedCycles) - 2);
      expect(peaks).toBeLessThanOrEqual(Math.round(expectedCycles) + 2);
      // Passband must preserve real oscillation amplitude (not collapse it near zero).
      const amp = Math.max(...filtered) - Math.min(...filtered);
      expect(amp).toBeGreaterThan(0.8);
    });
  }
});
