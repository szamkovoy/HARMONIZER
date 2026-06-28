function median3(a: number, b: number, c: number): number {
  if ((a <= b && b <= c) || (c <= b && b <= a)) return b;
  if ((b <= a && a <= c) || (c <= a && a <= b)) return a;
  return c;
}

function smoothRrMedian3(rr: readonly number[]): number[] {
  if (rr.length < 3) {
    return [...rr];
  }
  const smoothed = [...rr];
  for (let i = 1; i < rr.length - 1; i += 1) {
    smoothed[i] = median3(rr[i - 1]!, rr[i]!, rr[i + 1]!);
  }
  return smoothed;
}

/**
 * Finger-only smoothing for metric calculation.
 *
 * A single median-of-3 pass removes the classic local `short/long/short` PPG jitter,
 * but field parity runs against Polar H10 still showed residual alternation after one
 * pass. We therefore run the same conservative median-of-3 twice on RR before
 * reconstructing beats. This is still much gentler than a moving average: the slow
 * respiratory envelope is preserved, while high-frequency timestamp jitter is damped
 * enough for RMSSD / Baevsky stress to stop drifting away from chest-strap baselines.
 *
 * The sequence length stays unchanged: we smooth RR, then reconstruct beat timestamps
 * cumulatively from the original first beat.
 */
export function smoothBeatTimestampsMedian3ForMetrics(
  beats: readonly number[],
): number[] {
  if (beats.length < 4) {
    return [...beats];
  }

  const rr: number[] = [];
  for (let i = 1; i < beats.length; i += 1) {
    const interval = beats[i]! - beats[i - 1]!;
    if (!(interval > 0)) {
      return [...beats];
    }
    rr.push(interval);
  }

  const smoothedRr = smoothRrMedian3(smoothRrMedian3(rr));

  const out: number[] = [beats[0]!];
  for (let i = 0; i < smoothedRr.length; i += 1) {
    out.push(out[out.length - 1]! + smoothedRr[i]!);
  }
  return out;
}
