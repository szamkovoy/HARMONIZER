/**
 * Butterworth bandpass 4th order, 0.8–2.5 Hz (≈48–150 bpm), SOS from SciPy:
 *   `signal.butter(4, [0.8, 2.5], btype="band", fs=fs, output="sos")`
 * Zero-phase: forward `sosfilt` + reverse + forward + reverse (как scipy filtfilt).
 *
 * Перенесено из `modules/biofeedback/core/ppg-bandpass.ts` без изменения коэффициентов.
 */

export const BUTTERWORTH_PPG_SOS_FS_15 = [
  [7.36416457340664018e-3, 1.47283291468132804e-2, 7.36416457340664018e-3, 1.0, -9.86278848359422589e-1, 4.14742960894420198e-1],
  [1.0, 2.0, 1.0, 1.0, -1.43395963507059876e0, 5.95863283613348615e-1],
  [1.0, -2.0, 1.0, 1.0, -8.84043768808918551e-1, 6.92952227612269378e-1],
  [1.0, -2.0, 1.0, 1.0, -1.75574480171874669e0, 8.65762216239510551e-1],
] as const;

export const BUTTERWORTH_PPG_SOS_FS_20 = [
  [2.75981795854004326e-3, 5.51963591708008652e-3, 2.75981795854004326e-3, 1.0, -1.26629388668842324e0, 5.25280007079473865e-1],
  [1.0, 2.0, 1.0, 1.0, -1.58920771235659175e0, 6.85868744779213668e-1],
  [1.0, -2.0, 1.0, 1.0, -1.26255615501999441e0, 7.49339567038402432e-1],
  [1.0, -2.0, 1.0, 1.0, -1.83606425652100569e0, 8.993491691117661e-1],
] as const;

export const BUTTERWORTH_PPG_SOS_FS_24 = [
  [1.45723672735975792e-3, 2.91447345471951584e-3, 1.45723672735975792e-3, 1.0, -1.40090724089365692e0, 5.87898261337821637e-1],
  [1.0, 2.0, 1.0, 1.0, -1.66380752839778689e0, 7.32917424644376814e-1],
  [1.0, -2.0, 1.0, 1.0, -1.43368941084294832e0, 7.82885144888746387e-1],
  [1.0, -2.0, 1.0, 1.0, -1.87156988116153311e0, 9.15980421686007684e-1],
] as const;

export const BUTTERWORTH_PPG_SOS_FS_30 = [
  [6.56296362829915858e-4, 1.31259272565983172e-3, 6.56296362829915858e-4, 1.0, -1.53138513984700797e0, 6.5606360844632583e-1],
  [1.0, 2.0, 1.0, 1.0, -1.73612461036145049e0, 7.81654627339264829e-1],
  [1.0, -2.0, 1.0, 1.0, -1.58925288760257577e0, 8.19885039844006958e-1],
  [1.0, -2.0, 1.0, 1.0, -1.90387608292767441e0, 9.3258607810016525e-1],
] as const;

export const BUTTERWORTH_PPG_SOS_FS_40 = [
  [2.29332366588761604e-4, 4.58664733177523208e-4, 2.29332366588761604e-4, 1.0, -1.65721507724404393e0, 7.30435463944126617e-1],
  [1.0, 2.0, 1.0, 1.0, -1.80600647267361603e0, 8.32369882844602005e-1],
  [1.0, -2.0, 1.0, 1.0, -1.72650610078678435e0, 8.60240055956044358e-1],
  [1.0, -2.0, 1.0, 1.0, -1.93292127445920858e0, 9.49227690894327791e-1],
] as const;

type SosRow = readonly [number, number, number, number, number, number];
type Sos = readonly SosRow[];

function pickSosForSampleRateHz(sampleRateHz: number): Sos {
  const fs = Math.min(45, Math.max(12, sampleRateHz));
  const buckets: Array<{ hz: number; sos: Sos }> = [
    { hz: 15, sos: BUTTERWORTH_PPG_SOS_FS_15 },
    { hz: 20, sos: BUTTERWORTH_PPG_SOS_FS_20 },
    { hz: 24, sos: BUTTERWORTH_PPG_SOS_FS_24 },
    { hz: 30, sos: BUTTERWORTH_PPG_SOS_FS_30 },
    { hz: 40, sos: BUTTERWORTH_PPG_SOS_FS_40 },
  ];
  let best = buckets[3]!;
  let bestD = Infinity;
  for (const b of buckets) {
    const d = Math.abs(fs - b.hz);
    if (d < bestD) {
      bestD = d;
      best = b;
    }
  }
  return best.sos;
}

function sosfilt(sos: Sos, x: readonly number[]): number[] {
  const n = x.length;
  const y = new Array<number>(n);
  const nSections = sos.length;
  const zi = new Array(nSections).fill(0).map(() => [0, 0] as [number, number]);

  for (let i = 0; i < n; i += 1) {
    let xCur = x[i]!;
    for (let s = 0; s < nSections; s += 1) {
      const [b0, b1, b2, _a0, a1, a2] = sos[s]!;
      const z = zi[s]!;
      const yCur = b0 * xCur + z[0];
      z[0] = b1 * xCur - a1 * yCur + z[1];
      z[1] = b2 * xCur - a2 * yCur;
      xCur = yCur;
    }
    y[i] = xCur;
  }
  return y;
}

function reverseInPlace(a: number[]): void {
  for (let i = 0, j = a.length - 1; i < j; i += 1, j -= 1) {
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
}

/** Zero-phase bandpass (matches scipy `sosfiltfilt` for same SOS). */
export function sosfiltFiltfilt(sos: Sos, x: readonly number[]): number[] {
  if (x.length < 8) {
    return [...x];
  }
  let a = sosfilt(sos, x);
  reverseInPlace(a);
  a = sosfilt(sos, a);
  reverseInPlace(a);
  return a;
}

/**
 * DC-removed series → pulse band (Butterworth), zero-phase.
 * Input: typically `optical - median(optical)` over the sliding window.
 */
export function bandpassPpgForPeakDetection(
  detrendedSeries: readonly number[],
  sampleRateHz: number,
): number[] {
  if (detrendedSeries.length < 16 || sampleRateHz < 8) {
    return [...detrendedSeries];
  }
  const sos = pickSosForSampleRateHz(sampleRateHz);
  return sosfiltFiltfilt(sos, detrendedSeries);
}
