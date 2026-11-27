import { describe, expect, it } from "vitest";

import {
  estimateMarkerTimeLabelHalfWidthPx,
  layoutMarkerTimeLabelCenters,
  MARKER_TIME_LABEL_GAP_PX,
} from "./opportunityChartMarkerLabels";

const CHART_W = 320;

function centersPx(map: Map<string, number>, key: string): number {
  return (map.get(key) ?? 0) * CHART_W;
}

function halfW(label: string): number {
  return estimateMarkerTimeLabelHalfWidthPx(label);
}

describe("layoutMarkerTimeLabelCenters", () => {
  it("keeps isolated labels inside chart edges", () => {
    const w = halfW("23:05");
    const map = layoutMarkerTimeLabelCenters(CHART_W, [{ key: "sunrise", x: 0.96, halfWidthPx: w }]);
    const c = centersPx(map, "sunrise");
    expect(c + w).toBeLessThanOrEqual(CHART_W - 2);
    expect(c - w).toBeGreaterThanOrEqual(2);
  });

  it("keeps early-morning label inside left edge", () => {
    const w = halfW("00:05");
    const map = layoutMarkerTimeLabelCenters(CHART_W, [{ key: "sunrise", x: 0.003, halfWidthPx: w }]);
    const c = centersPx(map, "sunrise");
    expect(c - w).toBeGreaterThanOrEqual(2);
  });

  it("separates close labels with minimum gap and centers cluster on dots", () => {
    const w630 = halfW("06:30");
    const w730 = halfW("07:30");
    const x630 = (6 * 60 + 30) / 1440;
    const x730 = (7 * 60 + 30) / 1440;
    const map = layoutMarkerTimeLabelCenters(CHART_W, [
      { key: "culmination", x: x630, halfWidthPx: w630 },
      { key: "exactAspect", x: x730, halfWidthPx: w730 },
    ]);
    const c630 = centersPx(map, "culmination");
    const c730 = centersPx(map, "exactAspect");
    const gap = c730 - w730 - (c630 + w630);
    expect(gap).toBeGreaterThanOrEqual(MARKER_TIME_LABEL_GAP_PX - 0.5);
    const dotMid = ((x630 + x730) / 2) * CHART_W;
    const labelMid = (c630 + c730) / 2;
    expect(Math.abs(labelMid - dotMid)).toBeLessThan(24);
  });
});