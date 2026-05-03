import type { MandalaSoundBand } from "@/modules/mandala-sound/core/types";

export const MANDALA_SOUND_MIN_TARGET_HZ = 2;
export const MANDALA_SOUND_MAX_TARGET_HZ = 16;

type TimelinePoint = {
  at: number;
  hz: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function timelineForDuration(durationMs: number): TimelinePoint[] {
  const minutes = durationMs / 60_000;

  if (minutes < 6) {
    return [
      { at: 0, hz: 14 },
      { at: 0.45, hz: 10 },
      { at: 1, hz: 7.5 },
    ];
  }

  if (minutes < 12) {
    return [
      { at: 0, hz: 15 },
      { at: 0.28, hz: 10 },
      { at: 0.78, hz: 6 },
      { at: 1, hz: 5 },
    ];
  }

  return [
    { at: 0, hz: 16 },
    { at: 0.25, hz: 10 },
    { at: 0.68, hz: 6 },
    { at: 0.92, hz: 2.5 },
    { at: 1, hz: 2 },
  ];
}

export function getMandalaSoundTargetHz(
  elapsedMs: number,
  durationMs: number,
): number {
  const safeDurationMs = Math.max(1, durationMs);
  const progress = clamp(elapsedMs / safeDurationMs, 0, 1);
  const points = timelineForDuration(safeDurationMs);

  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]!;
    const next = points[i]!;
    if (progress <= next.at) {
      const segmentT = (progress - prev.at) / Math.max(0.0001, next.at - prev.at);
      return clamp(
        lerp(prev.hz, next.hz, smoothstep(segmentT)),
        MANDALA_SOUND_MIN_TARGET_HZ,
        MANDALA_SOUND_MAX_TARGET_HZ,
      );
    }
  }

  return points[points.length - 1]!.hz;
}

export function getMandalaSoundBand(targetHz: number): MandalaSoundBand {
  if (targetHz < 4) return "delta";
  if (targetHz < 8) return "theta";
  if (targetHz < 13) return "alpha";
  return "beta";
}
