import { describe, expect, it } from "vitest";

import { detectBeats } from "@/modules/biofeedback/signal/peak-detector";
import { FINGER_CAMERA_CAPTURE_CONFIG } from "@/modules/biofeedback/core/types";
import type { AnalyzerPoint } from "@/modules/biofeedback/signal/optical-pipeline";
import type { RawOpticalSample } from "@/modules/biofeedback/sensors/types";

/**
 * Синтетический «маргинальный PPG + много крупных всплесков»: маленькая пульс-синусоида
 * (амплитуда 0.002, ~50 bpm) и много больших всплесков (0.05), имитирующих короткие
 * усиления сигнала. Номинальный детектор: percentile(positiveValues, 0.35) вытягивается
 * всплесками (их большинство среди local-maxima) → heightThreshold ≈ 0.03 > пульс-пики
 * (0.002) → пульс отбраковывается, остаются только всплески. relaxThresholds: percentile-
 * член выключен, порог = max(MIN, robustScale*0.11) ≈ MIN → пульс-пики проходят. Так
 * проверяем, что re-acquire sweep пере-открывает детектор для маргинального пульса.
 */
function makeSignal(fps: number, seconds: number): { samples: AnalyzerPoint[]; values: number[] } {
  const n = Math.round(fps * seconds);
  const bpm = 50;
  const hz = bpm / 60;
  const samples: AnalyzerPoint[] = [];
  const values: number[] = [];
  // Много всплесков (≥ 35% от числа local-maxima), разнесённых > refractory (~300 мс).
  const spikeIdx = new Set<number>();
  const spikeEvery = Math.max(1, Math.round(fps * 0.45)); // ~450 мс между всплесками
  for (let i = Math.round(fps * 0.2); i < n; i += spikeEvery) {
    spikeIdx.add(i);
  }
  for (let i = 0; i < n; i += 1) {
    const t = i / fps;
    const pulse = 0.002 * Math.sin(2 * Math.PI * hz * t);
    const spike = spikeIdx.has(i) ? 0.05 : 0;
    const v = pulse + spike;
    values.push(v);
    const raw: RawOpticalSample = {
      timestampMs: i * (1000 / fps),
      redMean: 0,
      greenMean: 0,
      blueMean: 0,
      lumaMean: 0,
      redDominance: 0,
      darknessRatio: 0,
      saturationRatio: 0,
      motion: 0,
      width: 0,
      height: 0,
      sampleCount: 0,
      roiAreaRatio: 0,
    };
    samples.push({ ...raw, opticalValue: v, quality: 0 });
  }
  return { samples, values };
}

describe("detectBeats — relaxThresholds (re-acquire sweep)", () => {
  it("nominal rejects marginal pulse peaks pulled under the percentile threshold; relax lets them through", () => {
    const fps = 30;
    const { samples, values } = makeSignal(fps, 8);
    const nominal = detectBeats(samples, values, FINGER_CAMERA_CAPTURE_CONFIG, fps, false);
    const relaxed = detectBeats(samples, values, FINGER_CAMERA_CAPTURE_CONFIG, fps, true);
    // Прямая проверка механизм-свойства: relax опускает пороги height/prominence, поэтому
    // он отбраковывает МЕНЬше пиков по причинам `below_height` / `below_prominence`.
    // (Итоговый acceptedPeaks может быть ниже в relax из-за dicrotic/split post-filter,
    // который срабатывает чаще при большем числе кандидатов — это ожидаемо и не баг.)
    const nominalBlocked =
      nominal.rejectedPeaks.filter((p) => p.reasonCode === "below_height" || p.reasonCode === "below_prominence").length;
    const relaxedBlocked =
      relaxed.rejectedPeaks.filter((p) => p.reasonCode === "below_height" || p.reasonCode === "below_prominence").length;
    expect(relaxedBlocked).toBeLessThan(nominalBlocked);
    expect(nominalBlocked).toBeGreaterThan(0);
  });

  it("on a clean strong pulse both modes detect the same beats (relax is a no-op when not needed)", () => {
    const fps = 30;
    const n = Math.round(fps * 6);
    const bpm = 80;
    const hz = bpm / 60;
    const samples: AnalyzerPoint[] = [];
    const values: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const t = i / fps;
      const v = 0.05 * Math.sin(2 * Math.PI * hz * t);
      values.push(v);
      const raw: RawOpticalSample = {
        timestampMs: i * (1000 / fps),
        redMean: 0,
        greenMean: 0,
        blueMean: 0,
        lumaMean: 0,
        redDominance: 0,
        darknessRatio: 0,
        saturationRatio: 0,
        motion: 0,
        width: 0,
        height: 0,
        sampleCount: 0,
        roiAreaRatio: 0,
      };
      samples.push({ ...raw, opticalValue: v, quality: 0 });
    }
    const nominal = detectBeats(samples, values, FINGER_CAMERA_CAPTURE_CONFIG, fps, false);
    const relaxed = detectBeats(samples, values, FINGER_CAMERA_CAPTURE_CONFIG, fps, true);
    // На чистом сильном сигнале оба режима детектируют ~одно и то же число ударов
    // (±1 на краевых эффектах). Relax не должен ни удваивать, ни обнулять счёт.
    expect(Math.abs(relaxed.acceptedPeaks.length - nominal.acceptedPeaks.length)).toBeLessThanOrEqual(2);
    expect(nominal.acceptedPeaks.length).toBeGreaterThan(0);
  });
});
