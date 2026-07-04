/**
 * On-body plausibility gates for BLE RR packets.
 * Polar H10 may keep streaming HR with garbage RR (≈300 ms) when the strap is off-body.
 */

/**
 * Minimum RR (ms) treated as a live chest-strap beat for metrics and graphs.
 *
 * 350 ms = 171 bpm. The previous 450 ms floor (133 bpm) silently dropped every genuine
 * high-HR beat during exertion — e.g. a field test with push-ups peaked at 134 bpm (≈448 ms
 * RR) and those real beats were discarded, tearing spurious signal-loss gaps into an on-body
 * Polar stream and leaving holes in the tachogram (RSA/coherence breaks). Off-body Polar
 * garbage is a *sustained* burst of ~200–320 ms RR, which still sits below this floor.
 */
export const WEARABLE_ON_BODY_RR_MIN_MS = 350;

/** Maximum RR (ms) treated as a live chest-strap beat for metrics and graphs (≈40 bpm). */
export const WEARABLE_ON_BODY_RR_MAX_MS = 1_500;

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
 * Returns false only when the packet has **no** usable on-body RR at all (whole packet is
 * off-body garbage / a physiologically impossible burst).
 *
 * IMPORTANT: a single bad interval must not discard the whole packet. Polar occasionally emits
 * one implausible RR (a missed/merged beat → e.g. an 8.7 s interval, or a sub-350 ms double
 * beat) inside an otherwise clean multi-RR notification, especially while HR is changing fast.
 * We drop just those intervals via {@link filterOnBodyWearableRrIntervals} and keep the good
 * ones; only a packet where *nothing* is plausible is treated as untrustworthy. Sustained loss
 * (strap removed) is detected separately by the RR-staleness watchdog, not by one packet.
 */
export function isWearableRrPacketTrustworthy(rrIntervalsMs: readonly number[]): boolean {
  if (rrIntervalsMs.length === 0) return false;
  return filterOnBodyWearableRrIntervals(rrIntervalsMs).length > 0;
}

/**
 * Frozen-RR detection (off-body chest strap). When a Polar H10 (or similar) is lifted off the
 * chest it keeps emitting HR/RR packets, but the RR intervals collapse to a near-constant value
 * (field test 1783096820335: a stream of exact 659 ms RR → bogus 91 bpm) because there is no real
 * cardiac waveform to time. Real RR always varies beat-to-beat (even at very low HRV the
 * beat-to-beat jitter is ~10–20 ms); a run of N consecutive RR within `toleranceMs` of each other
 * is physiologically impossible and is a reliable off-body signature. Range filtering
 * (`filterOnBodyWearableRrIntervals`) cannot catch this because 659 ms is in range — only
 * run-level variance can.
 *
 * `recentRrMs` is the rolling RR history (across packets, plausible-only). Returns true when the
 * tail of that history is a frozen run: the last `minCount` intervals all lie within
 * `toleranceMs` of their mean.
 */
export const FROZEN_RR_RUN_MIN_COUNT = 6;
export const FROZEN_RR_RUN_TOLERANCE_MS = 8;
/**
 * Max HR-field swing (max − min over the same window) that is still consistent with a real
 * low-HRV on-body run (bhastrika / deep meditation). Off-body Polar HR field jumps wildly
 * (field 1783096820335: 115/120/75/85/140/150/169/91 → swing >80), while a real low-HRV run
 * holds the HR field within a few bpm (field 1783123388556 bhastrika: 66–68 → swing 2).
 */
export const FROZEN_RR_RUN_HR_STABLE_SPAN_BPM = 6;
/** Max |HR field − RR-derived bpm| for them to be "consistent" (real on-body). */
export const FROZEN_RR_RUN_HR_DISAGREEMENT_BPM = 12;

/**
 * Frozen-RR detection (off-body chest strap). See module doc.
 *
 * `recentRrMs` is the rolling RR history (across packets, plausible-only). Returns true when the
 * tail of that history is a frozen run: the last `minCount` intervals all lie within
 * `toleranceMs` of their mean.
 *
 * **HR-field guard (1.2.25):** a real low-HRV on-body run (bhastrika, deep meditation) can hold
 * RR within ±8 ms beat-to-beat on a high-precision strap like the Polar H10, which previously
 * tripped a false frozen → `signalLost` → a mid-practice gray band even though the strap was on
 * the chest (field 1783123388556). Off-body frozen is distinguished from real low-HRV by the HR
 * field: off-body HR swings wildly and disagrees with the frozen RR-derived bpm; real low-HRV HR
 * is stable and consistent with RR. When `recentHeartRateBpm` is supplied, a frozen-looking RR
 * run is treated as real (returns false) if the HR field is stable
 * (span ≤ `FROZEN_RR_RUN_HR_STABLE_SPAN_BPM`) AND consistent with the RR-derived bpm
 * (|hr − 60_000/rrMean| ≤ `FROZEN_RR_RUN_HR_DISAGREEMENT_BPM`).
 */
export function isFrozenRrRun(
  recentRrMs: readonly number[],
  minCount: number = FROZEN_RR_RUN_MIN_COUNT,
  toleranceMs: number = FROZEN_RR_RUN_TOLERANCE_MS,
  recentHeartRateBpm?: readonly number[],
): boolean {
  if (recentRrMs.length < minCount) return false;
  const tail = recentRrMs.slice(-minCount);
  let sum = 0;
  for (const v of tail) sum += v;
  const mean = sum / tail.length;
  for (const v of tail) {
    if (Math.abs(v - mean) > toleranceMs) return false;
  }
  // RR looks frozen. Distinguish off-body (wild/disagreeing HR field) from real low-HRV
  // (stable, consistent HR field) using the HR-field guard.
  if (recentHeartRateBpm != null && recentHeartRateBpm.length >= minCount) {
    const hrTail = recentHeartRateBpm.slice(-minCount);
    let hrMin = Infinity;
    let hrMax = -Infinity;
    let hrSum = 0;
    for (const hr of hrTail) {
      if (hr < hrMin) hrMin = hr;
      if (hr > hrMax) hrMax = hr;
      hrSum += hr;
    }
    const hrSpan = hrMax - hrMin;
    const hrMean = hrSum / hrTail.length;
    const rrDerivedBpm = mean > 0 ? 60_000 / mean : 0;
    const hrStable = hrSpan <= FROZEN_RR_RUN_HR_STABLE_SPAN_BPM;
    const hrConsistent =
      rrDerivedBpm > 0 && Math.abs(hrMean - rrDerivedBpm) <= FROZEN_RR_RUN_HR_DISAGREEMENT_BPM;
    if (hrStable && hrConsistent) {
      // Real low-HRV on-body run (e.g. bhastrika): RR is genuinely near-constant AND the HR
      // field agrees — not an off-body signature.
      return false;
    }
  }
  return true;
}
