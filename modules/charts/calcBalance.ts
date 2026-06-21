const SPHERE_COUNT = 7;

export type BalanceResult = {
  balance: number;
  angle: number;
};

/** Life-sphere balance from seven weights (zeros allowed). */
export function calcBalance(weights: readonly number[]): BalanceResult {
  const N = SPHERE_COUNT;
  const padded = Array.from({ length: N }, (_, index) => Math.max(0, Number(weights[index]) || 0));
  const total = padded.reduce((sum, weight) => sum + weight, 0);
  if (total === 0) return { balance: 0, angle: 0 };

  const active = padded.filter((weight) => weight > 0);
  const n = active.length;

  if (n === 1) {
    const balance = Math.round((1 / N) * 100);
    return { balance, angle: (balance / 100) * 360 };
  }

  const shares = active.map((weight) => weight / total);
  const ideal = 1 / n;
  const mad = shares.reduce((sum, share) => sum + Math.abs(share - ideal), 0) / n;
  const maxMad = (n - 1) / n;
  const balance = Math.round((1 - mad / maxMad) * (n / N) * 100);
  return { balance, angle: (balance / 100) * 360 };
}

export function segmentsToWeights(segments: ReadonlyArray<{ id: number; value: number }>): number[] {
  const weights = Array(SPHERE_COUNT).fill(0);
  for (const segment of segments) {
    if (segment.id >= 1 && segment.id <= SPHERE_COUNT) {
      weights[segment.id - 1] = Math.max(0, segment.value);
    }
  }
  return weights;
}
