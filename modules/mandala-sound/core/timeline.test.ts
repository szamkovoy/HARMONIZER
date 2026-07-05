import { describe, expect, it } from "vitest";

import {
  MANDALA_SOUND_MAX_TARGET_HZ,
  MANDALA_SOUND_MIN_TARGET_HZ,
  MANDALA_SOUND_START_HZ,
  getMandalaSoundBand,
  getMandalaSoundEndHz,
  getMandalaSoundTargetHz,
} from "@/modules/mandala-sound/core/timeline";

const MIN = 60_000;

describe("mandala sound timeline — f_end table (PDF)", () => {
  // durationMin → expected f_end (Hz), по таблице исследования.
  const cases: Array<{ minutes: number; hz: number }> = [
    { minutes: 1, hz: 11 },
    { minutes: 2, hz: 9.5 },
    { minutes: 3, hz: 8 },
    { minutes: 4, hz: 7 },
    { minutes: 5, hz: 6 },
    { minutes: 8, hz: 4.5 },
    { minutes: 10, hz: 3.5 },
    { minutes: 15, hz: 2.75 },
    { minutes: 20, hz: 2 },
  ];

  for (const { minutes, hz } of cases) {
    it(`f_end(${minutes} min) ≈ ${hz} Hz`, () => {
      expect(getMandalaSoundEndHz(minutes)).toBeCloseTo(hz, 2);
    });
  }

  it("clamps very long practices to the 2 Hz floor", () => {
    expect(getMandalaSoundEndHz(60)).toBe(MANDALA_SOUND_MIN_TARGET_HZ);
  });
});

describe("mandala sound timeline — sigmoid f(t)", () => {
  it("starts near 12 Hz (alpha high) for every duration", () => {
    for (const minutes of [1, 2, 3, 5, 8, 10, 15, 20]) {
      const f0 = getMandalaSoundTargetHz(0, minutes * MIN);
      // Сигмоида на t=0 чуть ниже f_start из-за экспоненты, но в диапазоне 11.5–12.
      expect(f0).toBeGreaterThanOrEqual(11.5);
      expect(f0).toBeLessThanOrEqual(MANDALA_SOUND_START_HZ);
      // Старт всегда в альфа (безопасная полоса, не бета).
      expect(getMandalaSoundBand(f0)).toBe("alpha");
    }
  });

  it("finishes near f_end for each duration", () => {
    // f(T_sec) чуть выше f_end из-за хвоста сигмоиды; значения из таблицы PDF.
    const cases: Array<{ minutes: number; hz: number }> = [
      { minutes: 1, hz: 11.02 },
      { minutes: 3, hz: 8.08 },
      { minutes: 5, hz: 6.13 },
      { minutes: 10, hz: 3.68 },
      { minutes: 20, hz: 2.21 },
    ];
    for (const { minutes, hz } of cases) {
      const fT = getMandalaSoundTargetHz(minutes * MIN, minutes * MIN);
      expect(fT).toBeCloseTo(hz, 1);
    }
  });

  it("monotonically decreases over the session", () => {
    const durationMs = 10 * MIN;
    let prev = Infinity;
    for (let t = 0; t <= durationMs; t += 1_000) {
      const f = getMandalaSoundTargetHz(t, durationMs);
      expect(f).toBeLessThanOrEqual(prev + 1e-9);
      prev = f;
    }
  });

  it("never exceeds the 13 Hz safety cap and never drops below 2 Hz", () => {
    for (const minutes of [1, 3, 5, 10, 20]) {
      const durationMs = minutes * MIN;
      for (let t = 0; t <= durationMs; t += 500) {
        const f = getMandalaSoundTargetHz(t, durationMs);
        expect(f).toBeGreaterThanOrEqual(MANDALA_SOUND_MIN_TARGET_HZ);
        expect(f).toBeLessThanOrEqual(MANDALA_SOUND_MAX_TARGET_HZ);
      }
    }
  });

  it("long (20 min) practice glides alpha → theta → delta, never beta", () => {
    const durationMs = 20 * MIN;
    expect(getMandalaSoundBand(getMandalaSoundTargetHz(0, durationMs))).toBe("alpha");
    // В середине — уже тета.
    expect(getMandalaSoundBand(getMandalaSoundTargetHz(durationMs * 0.6, durationMs))).toBe("theta");
    // Ближе к финалу — дельта.
    expect(getMandalaSoundBand(getMandalaSoundTargetHz(durationMs * 0.95, durationMs))).toBe("delta");
  });

  it("short (3 min) practice stays out of delta", () => {
    const durationMs = 3 * MIN;
    const endHz = getMandalaSoundTargetHz(durationMs, durationMs);
    expect(endHz).toBeGreaterThanOrEqual(7);
    // 3 мин → f_end=8 (граница альфа/тета), но не дельта.
    expect(getMandalaSoundBand(endHz)).not.toBe("delta");
  });

  it("peak descent rate stays within physiological comfort (<3 Hz/min)", () => {
    // Пиковая скорость сброса — в точке перегиба t_mid = 0.45·T.
    // Производная сигмоиды в t_mid: |f'| = (f_start - f_end) · k / 4.
    // Переводим в Гц/мин и проверяем мягкость дрейфа.
    const cases: Array<{ minutes: number; maxRatePerMin: number }> = [
      { minutes: 3, maxRatePerMin: 3.0 }, // короткая — допускаем до 3
      { minutes: 10, maxRatePerMin: 2.0 },
      { minutes: 20, maxRatePerMin: 1.0 },
    ];
    for (const { minutes, maxRatePerMin } of cases) {
      const durationMs = minutes * MIN;
      const Tsec = durationMs / 1000;
      const fEnd = getMandalaSoundEndHz(minutes);
      const k = 7 / Tsec;
      const peakRateHzPerSec = ((MANDALA_SOUND_START_HZ - fEnd) * k) / 4;
      const peakRateHzPerMin = peakRateHzPerSec * 60;
      expect(peakRateHzPerMin).toBeLessThan(maxRatePerMin);
    }
  });
});
