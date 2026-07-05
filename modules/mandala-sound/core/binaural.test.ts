import { describe, expect, it } from "vitest";

import { binauralCrossfadeGains } from "@/modules/mandala-sound/core/binaural";

const BEATS = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2.5, 2];

describe("binaural crossfade gains", () => {
  it("fully favours the matching loop on an exact beat frequency", () => {
    const g = binauralCrossfadeGains(10, BEATS);
    expect(g[BEATS.indexOf(10)]).toBeCloseTo(1, 6);
    // Соседние loop'ы заглушены.
    expect(g[BEATS.indexOf(11)]).toBeCloseTo(0, 6);
    expect(g[BEATS.indexOf(9)]).toBeCloseTo(0, 6);
    // Сумма активных gain'ов = 1.
    expect(g.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 6);
  });

  it("splits gain evenly at the midpoint between two adjacent loops", () => {
    const g = binauralCrossfadeGains(9.5, BEATS);
    expect(g[BEATS.indexOf(10)]).toBeCloseTo(0.5, 6);
    expect(g[BEATS.indexOf(9)]).toBeCloseTo(0.5, 6);
    expect(g.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 6);
  });

  it("handles the non-uniform 2.5 → 2 step correctly", () => {
    // Между 2.5 и 2 (шаг 0.5): 2.25 → frac=(2.5-2.25)/0.5=0.5 → поровну.
    const g = binauralCrossfadeGains(2.25, BEATS);
    expect(g[BEATS.indexOf(2.5)]).toBeCloseTo(0.5, 6);
    expect(g[BEATS.indexOf(2)]).toBeCloseTo(0.5, 6);
    expect(g.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 6);
  });

  it("clamps above the max beat to the highest loop", () => {
    const g = binauralCrossfadeGains(13, BEATS);
    expect(g[0]).toBeCloseTo(1, 6); // 12 Гц loop
    expect(g.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 6);
  });

  it("clamps below the min beat to the lowest loop", () => {
    const g = binauralCrossfadeGains(1, BEATS);
    expect(g[BEATS.length - 1]).toBeCloseTo(1, 6); // 2 Гц loop
    expect(g.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 6);
  });

  it("activates only one or two loops at a time (no leakage to distant loops)", () => {
    for (const f of [12, 11.3, 9.5, 7, 4.6, 2.5, 2]) {
      const g = binauralCrossfadeGains(f, BEATS);
      const active = g.filter((v) => v > 1e-6).length;
      expect(active).toBeLessThanOrEqual(2);
    }
  });
});
