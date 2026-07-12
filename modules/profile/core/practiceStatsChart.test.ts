import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import {
  buildPracticeStatsChartModel,
  defaultPracticeStatsSelectionIndex,
  formatPracticeStatsDate,
  nearestPracticeStatsBarIndex,
  niceScaleMaxMinutes,
  practiceStatsBarCenterX,
  practiceStatsCalloutLeft,
  practiceStatsLocalWindow,
  secondsToPracticeMinutes,
} from "@/modules/profile/core/practiceStatsChart";

describe("practiceStatsChart", () => {
  it("formats dates as DD.MM", () => {
    expect(formatPracticeStatsDate("2026-07-02")).toBe("02.07");
    expect(formatPracticeStatsDate("2026-12-31")).toBe("31.12");
  });

  it("converts seconds to rounded minutes", () => {
    expect(secondsToPracticeMinutes(0)).toBe(0);
    expect(secondsToPracticeMinutes(59)).toBe(1);
    expect(secondsToPracticeMinutes(95 * 60)).toBe(95);
  });

  it("builds a nice Y-axis ceiling", () => {
    expect(niceScaleMaxMinutes(95)).toBe(100);
    expect(niceScaleMaxMinutes(333)).toBe(500);
  });

  it("centers bars accounting for flex row gap", () => {
    const width = 300;
    const gap = 6;
    const count = 7;
    const first = practiceStatsBarCenterX(0, count, width, gap);
    const last = practiceStatsBarCenterX(count - 1, count, width, gap);
    const columnWidth = (width - gap * (count - 1)) / count;
    expect(first).toBeCloseTo(columnWidth / 2, 5);
    expect(last).toBeCloseTo(width - columnWidth / 2, 5);
    expect(nearestPracticeStatsBarIndex(first + 1, count, width, gap)).toBe(0);
    expect(nearestPracticeStatsBarIndex(last - 1, count, width, gap)).toBe(count - 1);
  });

  it("defaults selection to the first bar", () => {
    expect(defaultPracticeStatsSelectionIndex([{ minutes: 0 }, { minutes: 12 }, { minutes: 0 }])).toBe(0);
    expect(defaultPracticeStatsSelectionIndex([{ minutes: 0 }, { minutes: 0 }])).toBe(0);
  });

  it("keeps callout edge flush with the selection line", () => {
    expect(practiceStatsCalloutLeft(12, 120, 300)).toBe(12);
    expect(practiceStatsCalloutLeft(280, 120, 300)).toBe(160);
    expect(practiceStatsCalloutLeft(280, 120, 300) + 120).toBe(280);
  });

  it("builds a continuous 7-day series with DD.MM labels", () => {
    const now = DateTime.fromISO("2026-07-12T15:00:00", { zone: "Europe/Moscow" });
    const model = buildPracticeStatsChartModel({
      periodDays: 7,
      timezone: "Europe/Moscow",
      now,
      rows: [
        { local_date: "2026-07-11", total_practice_seconds: 95 * 60 },
        { local_date: "2026-07-12", total_practice_seconds: 15 * 60 },
      ],
    });

    expect(model.mode).toBe("day");
    expect(model.bars).toHaveLength(7);
    expect(model.fromLocalDate).toBe("2026-07-06");
    expect(model.throughLocalDate).toBe("2026-07-12");
    expect(model.bars.every((bar) => bar.showDateLabel)).toBe(true);
    expect(model.bars[0]?.dateLabel).toBe("06.07");
    expect(model.bars[5]?.minutes).toBe(95);
    expect(model.bars.every((bar) => !bar.showValue)).toBe(true);
    expect(model.bars[0]?.minutes).toBe(0);
    expect(model.yTicks[0]).toBeGreaterThanOrEqual(95);
    expect(model.yTicks[model.yTicks.length - 1]).toBe(0);
  });

  it("uses sparse date labels for 30 days", () => {
    const now = DateTime.fromISO("2026-07-12T12:00:00", { zone: "UTC" });
    const model = buildPracticeStatsChartModel({
      periodDays: 30,
      timezone: "UTC",
      now,
      rows: [{ local_date: "2026-07-12", total_practice_seconds: 1800 }],
    });

    expect(model.mode).toBe("day");
    expect(model.bars).toHaveLength(30);
    const labeled = model.bars.filter((bar) => bar.showDateLabel);
    expect(labeled.length).toBeLessThanOrEqual(5);
    expect(labeled[0]?.dateLabel).toBe(formatPracticeStatsDate(model.fromLocalDate));
    expect(labeled[labeled.length - 1]?.dateLabel).toBe(formatPracticeStatsDate(model.throughLocalDate));
    expect(model.bars.every((bar) => !bar.showValue)).toBe(true);
  });

  it("aggregates 90 days into weekly average minutes/day", () => {
    const now = DateTime.fromISO("2026-07-12T12:00:00", { zone: "UTC" });
    const window = practiceStatsLocalWindow(90, "UTC", now);
    const rows = [
      { local_date: window.fromLocalDate, total_practice_seconds: 60 * 60 },
      { local_date: window.throughLocalDate, total_practice_seconds: 30 * 60 },
    ];
    const model = buildPracticeStatsChartModel({
      periodDays: 90,
      timezone: "UTC",
      now,
      rows,
    });

    expect(model.mode).toBe("week");
    expect(model.bars.length).toBe(13);
    expect(model.bars[0]?.minutes).toBe(Math.round(60 / 7));
    expect(model.bars[model.bars.length - 1]?.minutes).toBeGreaterThan(0);
    expect(model.bars.filter((bar) => bar.showDateLabel).length).toBeLessThanOrEqual(5);
  });
});
