import { DONUT_GAP_RAD } from "@/modules/charts/constants";

export type DonutSegmentInput = {
  id: number;
  value: number;
  color: string;
  label: string;
  legendSuffix?: string;
};

export type BuiltDonutSegment = DonutSegmentInput & {
  startAngle: number;
  endAngle: number;
};

const RAD_TO_DEG = 180 / Math.PI;

export function buildDonutSegments(items: readonly DonutSegmentInput[]) {
  const active = items.filter((item) => item.value > 0);
  const totalWeight = active.reduce((sum, item) => sum + item.value, 0);
  if (totalWeight <= 0) {
    return { segments: [] as BuiltDonutSegment[], totalSweepDeg: 0 };
  }

  const gapDeg = active.length > 1 ? DONUT_GAP_RAD * RAD_TO_DEG : 0;
  const totalGapDeg = gapDeg * active.length;
  const usableAngleDeg = 360 - totalGapDeg;

  let currentAngle = 0;
  const segments = active.map((item) => {
    const segAngle = (item.value / totalWeight) * usableAngleDeg;
    const startAngle = currentAngle + gapDeg / 2;
    const endAngle = startAngle + segAngle;
    currentAngle += segAngle + gapDeg;
    return {
      ...item,
      startAngle,
      endAngle,
    };
  });

  return { segments, totalSweepDeg: 360 };
}

export function clipDonutSegmentsForProgress(segments: readonly BuiltDonutSegment[], progress: number) {
  const clamped = Math.max(0, Math.min(1, progress));
  let remaining = clamped * 360;
  const visible: BuiltDonutSegment[] = [];

  for (const segment of segments) {
    const span = segment.endAngle - segment.startAngle;
    if (remaining <= 0) break;
    if (remaining >= span) {
      visible.push(segment);
      remaining -= span;
    } else {
      visible.push({
        ...segment,
        endAngle: segment.startAngle + remaining,
      });
      remaining = 0;
    }
  }

  return visible;
}
