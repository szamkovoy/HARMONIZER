/** Оценка полу-ширины подписи времени под точкой до первого onLayout. */
export const MARKER_TIME_LABEL_FALLBACK_HALF_W_PX = 16;
/** Минимальный зазор между соседними подписями (край к краю), ~1–2 мм на типичном экране. */
export const MARKER_TIME_LABEL_GAP_PX = 6;
/** Небольшой воздух у краёв chartWrap, чтобы текст не обрезался. */
export const MARKER_TIME_LABEL_EDGE_GAP_PX = 2;

export type ChartMarkerLabelSlot = { key: string; x: number; halfWidthPx: number };

type PositionedChartLabelSlot = ChartMarkerLabelSlot & { idealCenterPx: number };

function clampLabelCenterPx(width: number, centerPx: number, halfWidthPx: number): number {
  if (!(width > 0)) return centerPx;
  const edge = Math.max(halfWidthPx + MARKER_TIME_LABEL_EDGE_GAP_PX, 1);
  return Math.min(width - edge, Math.max(edge, centerPx));
}

function clusterSpanWidthPx(slots: PositionedChartLabelSlot[]): number {
  if (slots.length === 0) return 0;
  let span = slots[0].halfWidthPx + slots[slots.length - 1].halfWidthPx;
  for (let i = 1; i < slots.length; i += 1) {
    span += slots[i - 1].halfWidthPx + slots[i].halfWidthPx + MARKER_TIME_LABEL_GAP_PX;
  }
  return span;
}

function placeLabelCluster(width: number, slots: PositionedChartLabelSlot[]): number[] {
  if (slots.length === 0) return [];
  const span = clusterSpanWidthPx(slots);
  const desiredMid =
    slots.reduce((sum, slot) => sum + slot.idealCenterPx, 0) / Math.max(1, slots.length);
  const minMid = span / 2 + MARKER_TIME_LABEL_EDGE_GAP_PX;
  const maxMid = width - span / 2 - MARKER_TIME_LABEL_EDGE_GAP_PX;
  const clusterMid = maxMid >= minMid ? Math.min(maxMid, Math.max(minMid, desiredMid)) : width / 2;

  const centers: number[] = [];
  let current = clusterMid - span / 2 + slots[0].halfWidthPx;
  centers.push(current);
  for (let i = 1; i < slots.length; i += 1) {
    current += slots[i - 1].halfWidthPx + slots[i].halfWidthPx + MARKER_TIME_LABEL_GAP_PX;
    centers.push(current);
  }
  return centers;
}

/**
 * Горизонтальный layout подписей времени под графиком: центры в долях ширины (0…1).
 * Точки на кривой остаются на своих x; смещаются только центры подписей.
 */
export function layoutMarkerTimeLabelCenters(width: number, slots: ChartMarkerLabelSlot[]): Map<string, number> {
  const out = new Map<string, number>();
  if (slots.length === 0) return out;
  if (!(width > 0)) {
    slots.forEach((s) => out.set(s.key, s.x));
    return out;
  }

  const sorted = [...slots]
    .sort((a, b) => a.x - b.x)
    .map<PositionedChartLabelSlot>((slot) => ({
      ...slot,
      idealCenterPx: clampLabelCenterPx(width, slot.x * width, slot.halfWidthPx),
    }));

  let clusters = sorted.map((slot) => [slot]);
  let placedClusters: Array<{ slots: PositionedChartLabelSlot[]; centers: number[] }> = [];

  for (let iter = 0; iter < Math.max(1, sorted.length); iter += 1) {
    placedClusters = clusters.map((cluster) => ({
      slots: cluster,
      centers: placeLabelCluster(width, cluster),
    }));

    let overlapAt = -1;
    for (let i = 1; i < placedClusters.length; i += 1) {
      const prev = placedClusters[i - 1];
      const next = placedClusters[i];
      const prevLastCenter = prev.centers[prev.centers.length - 1];
      const nextFirstCenter = next.centers[0];
      const minNextCenter =
        prevLastCenter +
        prev.slots[prev.slots.length - 1].halfWidthPx +
        next.slots[0].halfWidthPx +
        MARKER_TIME_LABEL_GAP_PX;
      if (nextFirstCenter < minNextCenter - 0.1) {
        overlapAt = i;
        break;
      }
    }

    if (overlapAt === -1) break;

    clusters = [
      ...clusters.slice(0, overlapAt - 1),
      [...clusters[overlapAt - 1], ...clusters[overlapAt]],
      ...clusters.slice(overlapAt + 1),
    ];
  }

  placedClusters.forEach((cluster) => {
    cluster.slots.forEach((slot, index) => {
      out.set(slot.key, cluster.centers[index] / width);
    });
  });
  return out;
}

export function estimateMarkerTimeLabelHalfWidthPx(timeLabel: string, measuredWidth?: number): number {
  const estimatedWidth = Math.max(
    MARKER_TIME_LABEL_FALLBACK_HALF_W_PX * 2,
    18 + timeLabel.length * 6,
  );
  const full = measuredWidth && measuredWidth > 0 ? measuredWidth : estimatedWidth;
  return full / 2;
}