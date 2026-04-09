function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function mean(values: readonly number[]) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function toRrIntervalsMs(beatTimestampsMs: readonly number[]) {
  const rrIntervals: number[] = [];
  for (let index = 1; index < beatTimestampsMs.length; index += 1) {
    const interval = beatTimestampsMs[index] - beatTimestampsMs[index - 1];
    if (interval > 0) {
      rrIntervals.push(interval);
    }
  }
  return rrIntervals;
}

export function calculatePulseRateBpm(rrIntervalsMs: readonly number[]) {
  const averageInterval = mean(rrIntervalsMs);
  if (averageInterval <= 0) {
    return 0;
  }
  return 60000 / averageInterval;
}

export function calculateRmssdMs(rrIntervalsMs: readonly number[]) {
  if (rrIntervalsMs.length < 2) {
    return 0;
  }

  const squaredDiffs: number[] = [];
  for (let index = 1; index < rrIntervalsMs.length; index += 1) {
    const diff = rrIntervalsMs[index] - rrIntervalsMs[index - 1];
    squaredDiffs.push(diff * diff);
  }

  return Math.sqrt(mean(squaredDiffs));
}

function buildModeBucket(rrIntervalsMs: readonly number[], bucketSizeMs: number) {
  const histogram = new Map<number, number>();

  for (const interval of rrIntervalsMs) {
    const bucket = Math.round(interval / bucketSizeMs) * bucketSizeMs;
    histogram.set(bucket, (histogram.get(bucket) ?? 0) + 1);
  }

  let modeBucketMs = 0;
  let modeCount = 0;
  for (const [bucketMs, count] of histogram.entries()) {
    if (count > modeCount) {
      modeBucketMs = bucketMs;
      modeCount = count;
    }
  }

  return { modeBucketMs, modeCount };
}

export function calculateBaevskyStressIndexRaw(
  rrIntervalsMs: readonly number[],
  bucketSizeMs = 50,
) {
  if (rrIntervalsMs.length < 3) {
    return 0;
  }

  const { modeBucketMs, modeCount } = buildModeBucket(rrIntervalsMs, bucketSizeMs);
  const modeSeconds = modeBucketMs / 1000;
  const amplitudePercent = (modeCount / rrIntervalsMs.length) * 100;
  const minInterval = Math.min(...rrIntervalsMs);
  const maxInterval = Math.max(...rrIntervalsMs);
  const variationRangeSeconds = (maxInterval - minInterval) / 1000;

  if (modeSeconds <= 0 || variationRangeSeconds <= 0) {
    return 0;
  }

  return amplitudePercent / (2 * modeSeconds * variationRangeSeconds);
}

export function mapBaevskyStressToPercent(rawStressIndex: number) {
  return clamp(((rawStressIndex - 50) / (900 - 50)) * 100, 0, 100);
}

export function normalizePulseRate(pulseRateBpm: number) {
  return clamp((pulseRateBpm - 40) / (180 - 40), 0, 1);
}

export function normalizeBreathRate(breathRateBpm: number) {
  return clamp((breathRateBpm - 5) / (30 - 5), 0, 1);
}

export function normalizeRmssd(rmssdMs: number) {
  return clamp((rmssdMs - 20) / (200 - 20), 0, 1);
}

export function normalizeStressIndex(stressIndex: number) {
  return clamp(stressIndex / 100, 0, 1);
}
