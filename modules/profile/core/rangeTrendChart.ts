export type CalendarTrendPoint = {
  localDate: string;
  rangeMetric: number;
};

import type { AppContentLocale } from "@/modules/i18n/localeCodes";

export type ChartPoint = {
  localDate: string;
  rangeMetric: number;
  x: number;
  y: number;
};

export type AxisTick = {
  localDate: string;
  x: number;
  label: string;
};

type AxisMode = "day" | "week" | "month" | "year";

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split("-").map((part) => Number.parseInt(part, 10));
  return new Date(year, (month ?? 1) - 1, day ?? 1, 12, 0, 0, 0);
}

function dateToMs(value: string): number {
  return parseLocalDate(value).getTime();
}

function chooseAxisMode(spanDays: number): AxisMode {
  if (spanDays <= 30) return "day";
  if (spanDays <= 90) return "week";
  if (spanDays <= 365) return "month";
  return "year";
}


export function formatAxisLabel(localDate: string, mode: AxisMode, locale: AppContentLocale = "ru"): string {
  const date = parseLocalDate(localDate);
  const intlLocale = locale === "ru" ? "ru" : locale;
  if (mode === "day" || mode === "week") {
    return new Intl.DateTimeFormat(intlLocale, { day: "numeric", month: "short" }).format(date);
  }
  if (mode === "month") {
    return new Intl.DateTimeFormat(intlLocale, { month: "short" }).format(date);
  }
  return new Intl.DateTimeFormat(intlLocale, { month: "short", year: "numeric" }).format(date);
}

function roundDateToTick(ms: number, mode: AxisMode): number {
  const date = new Date(ms);
  if (mode === "day" || mode === "week") {
    date.setHours(12, 0, 0, 0);
    return date.getTime();
  }
  if (mode === "month") {
    return new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0, 0).getTime();
  }
  const quarterMonth = Math.floor(date.getMonth() / 3) * 3;
  return new Date(date.getFullYear(), quarterMonth, 1, 12, 0, 0, 0).getTime();
}

function msToIsoDate(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function buildCalendarAxisTicks(
  points: CalendarTrendPoint[],
  width: number,
  padding: number,
  locale: AppContentLocale = "ru",
): AxisTick[] {
  if (!points.length) return [];

  const minMs = dateToMs(points[0]!.localDate);
  const maxMs = dateToMs(points[points.length - 1]!.localDate);
  const spanDays = Math.max(1, Math.round((maxMs - minMs) / 86_400_000));
  const mode = chooseAxisMode(spanDays);
  const plotWidth = Math.max(1, width - padding * 2);
  const tickCount = Math.min(7, Math.max(4, Math.round(spanDays <= 30 ? 5 : 6)));

  const ticks: AxisTick[] = [];
  for (let index = 0; index < tickCount; index += 1) {
    const ratio = tickCount === 1 ? 0 : index / (tickCount - 1);
    const ms = minMs + (maxMs - minMs) * ratio;
    const roundedMs = roundDateToTick(ms, mode);
    const localDate = msToIsoDate(roundedMs);
    ticks.push({
      localDate,
      x: padding + ratio * plotWidth,
      label: formatAxisLabel(localDate, mode, locale),
    });
  }
  return ticks;
}

export function buildChartPoints(
  points: CalendarTrendPoint[],
  width: number,
  height: number,
  padding: number,
): ChartPoint[] {
  if (!points.length) return [];

  const minMs = dateToMs(points[0]!.localDate);
  const maxMs = dateToMs(points[points.length - 1]!.localDate);
  const spanMs = Math.max(86_400_000, maxMs - minMs);
  const plotWidth = Math.max(1, width - padding * 2);
  const plotHeight = Math.max(1, height - padding * 2);

  return points.map((point) => {
    const ratioX = points.length === 1 ? 0.5 : (dateToMs(point.localDate) - minMs) / spanMs;
    const safeValue = Math.max(0, Math.min(1, point.rangeMetric));
    return {
      localDate: point.localDate,
      rangeMetric: point.rangeMetric,
      x: padding + ratioX * plotWidth,
      y: height - padding - safeValue * plotHeight,
    };
  });
}

export function buildSmoothLinePath(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) return "";
  if (points.length === 2) {
    return `M ${points[0]!.x} ${points[0]!.y} L ${points[1]!.x} ${points[1]!.y}`;
  }

  const segments: string[] = [`M ${points[0]!.x} ${points[0]!.y}`];
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)]!;
    const p1 = points[index]!;
    const p2 = points[index + 1]!;
    const p3 = points[Math.min(points.length - 1, index + 2)]!;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    segments.push(`C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`);
  }
  return segments.join(" ");
}
