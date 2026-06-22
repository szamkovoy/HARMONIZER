const SPHERE_COUNT = 7;
const EVENNESS_POWER = 1.6;

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

  const shares = padded.map((weight) => weight / total);
  const ideal = 1 / N;
  const sumSquaredDeviation = shares.reduce((sum, share) => sum + (share - ideal) ** 2, 0);
  const maxSquaredDeviation = (1 - ideal) ** 2 + (N - 1) * ideal ** 2;
  const normalizedDeviation = Math.min(1, Math.sqrt(sumSquaredDeviation / maxSquaredDeviation));
  const evenness = Math.max(0, 1 - normalizedDeviation);
  const balance = Math.max(1, Math.round(evenness ** EVENNESS_POWER * 100));
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
