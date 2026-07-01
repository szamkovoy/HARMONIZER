/**
 * On-body plausibility gates for BLE RR packets.
 * Polar H10 may keep streaming HR with garbage RR (≈300 ms) when the strap is off-body.
 */

/** Minimum RR (ms) treated as a live chest-strap beat for metrics and graphs. */
export const WEARABLE_ON_BODY_RR_MIN_MS = 450;

/** Maximum RR (ms) treated as a live chest-strap beat for metrics and graphs. */
export const WEARABLE_ON_BODY_RR_MAX_MS = 1_500;

/** RR above this is physiologically impossible for this flow and marks a broken packet. */
const WEARABLE_RR_PACKET_HARD_MAX_MS = 3_000;

const HEART_RATE_RR_DISAGREEMENT_BPM = 20;

export function isWearableRrIntervalOnBodyPlausible(intervalMs: number): boolean {
  return intervalMs >= WEARABLE_ON_BODY_RR_MIN_MS && intervalMs <= WEARABLE_ON_BODY_RR_MAX_MS;
}

export function filterOnBodyWearableRrIntervals(rrIntervalsMs: readonly number[]): number[] {
  return rrIntervalsMs.filter(isWearableRrIntervalOnBodyPlausible);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

export function deriveBpmFromWearableRrIntervals(rrIntervalsMs: readonly number[]): number | null {
  const plausible = filterOnBodyWearableRrIntervals(rrIntervalsMs);
  const rrMedian = median(plausible);
  return rrMedian != null && rrMedian > 0 ? 60_000 / rrMedian : null;
}

export function resolveWearableHeartRateBpm(
  heartRateBpm: number | null | undefined,
  rrDerivedBpm: number | null | undefined,
): number | null {
  const hr = heartRateBpm != null && Number.isFinite(heartRateBpm) && heartRateBpm > 0
    ? heartRateBpm
    : null;
  const rr = rrDerivedBpm != null && Number.isFinite(rrDerivedBpm) && rrDerivedBpm > 0
    ? rrDerivedBpm
    : null;
  if (hr == null) return rr;
  if (rr == null) return hr;
  return Math.abs(hr - rr) > HEART_RATE_RR_DISAGREEMENT_BPM ? rr : hr;
}

/**
 * Returns false when the packet contains off-body artifacts (very short RR bursts).
 * A single borderline interval is tolerated; sustained 300 ms RR indicates strap off skin.
 */
export function isWearableRrPacketTrustworthy(rrIntervalsMs: readonly number[]): boolean {
  if (rrIntervalsMs.length === 0) return false;
  if (rrIntervalsMs.some((rr) => rr > WEARABLE_RR_PACKET_HARD_MAX_MS)) return false;
  const minRr = Math.min(...rrIntervalsMs);
  if (minRr < 400) return false;
  const plausible = filterOnBodyWearableRrIntervals(rrIntervalsMs);
  return plausible.length > 0;
}
