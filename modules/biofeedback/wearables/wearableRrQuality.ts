/**
 * On-body plausibility gates for BLE RR packets.
 * Polar H10 may keep streaming HR with garbage RR (≈300 ms) when the strap is off-body.
 */

/** Minimum RR (ms) treated as a live chest-strap beat for metrics and graphs. */
export const WEARABLE_ON_BODY_RR_MIN_MS = 450;

/** Maximum RR (ms) treated as a live chest-strap beat for metrics and graphs. */
export const WEARABLE_ON_BODY_RR_MAX_MS = 1_500;

export function isWearableRrIntervalOnBodyPlausible(intervalMs: number): boolean {
  return intervalMs >= WEARABLE_ON_BODY_RR_MIN_MS && intervalMs <= WEARABLE_ON_BODY_RR_MAX_MS;
}

export function filterOnBodyWearableRrIntervals(rrIntervalsMs: readonly number[]): number[] {
  return rrIntervalsMs.filter(isWearableRrIntervalOnBodyPlausible);
}

/**
 * Returns false when the packet contains off-body artifacts (very short RR bursts).
 * A single borderline interval is tolerated; sustained 300 ms RR indicates strap off skin.
 */
export function isWearableRrPacketTrustworthy(rrIntervalsMs: readonly number[]): boolean {
  if (rrIntervalsMs.length === 0) return false;
  const minRr = Math.min(...rrIntervalsMs);
  if (minRr < 400) return false;
  const plausible = filterOnBodyWearableRrIntervals(rrIntervalsMs);
  return plausible.length > 0;
}
