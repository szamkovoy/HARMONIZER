import { DateTime } from "luxon";

export type PracticeStatsSourceRow = {
  local_date: string;
  total_practice_seconds: number | null;
};

export type PracticeStatsBar = {
  key: string;
  /** Displayed height metric: day total minutes, or week average minutes/day. */
  minutes: number;
  startLocalDate: string;
  endLocalDate: string;
  showValue: boolean;
  showDateLabel: boolean;
  dateLabel: string;
};

export type PracticeStatsChartModel = {
  mode: "day" | "week";
  bars: PracticeStatsBar[];
  maxMinutes: number;
  /** Rounded ceiling used for bar height + Y-axis (minutes). */
  scaleMaxMinutes: number;
  yTicks: number[];
  hasAnyPractice: boolean;
  fromLocalDate: string;
  throughLocalDate: string;
};

export function practiceStatsLocalWindow(
  periodDays: number,
  timezone: string,
  now: DateTime<boolean> = DateTime.utc(),
): { fromLocalDate: string; throughLocalDate: string } {
  const zone = timezone?.trim() || "UTC";
  const zonedNow = now.setZone(zone);
  const endLocalExclusive = zonedNow.startOf("day").plus({ days: 1 });
  const startLocalInclusive = endLocalExclusive.minus({ days: periodDays }).startOf("day");
  return {
    fromLocalDate: startLocalInclusive.toFormat("yyyy-MM-dd"),
    throughLocalDate: endLocalExclusive.minus({ days: 1 }).toFormat("yyyy-MM-dd"),
  };
}

/** Compact day.month — unambiguous across RU/EU locales and fits narrow bars. */
export function formatPracticeStatsDate(localDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate.trim());
  if (!match) return localDate;
  return `${match[3]}.${match[2]}`;
}

export function secondsToPracticeMinutes(seconds: number | null | undefined): number {
  const safe = Number(seconds);
  if (!Number.isFinite(safe) || safe <= 0) return 0;
  return Math.round(safe / 60);
}

/** Callout label: whole minutes, or one decimal for small weekly averages. */
export function formatPracticeStatsCalloutMinutes(minutes: number): string {
  const safe = Number(minutes);
  if (!Number.isFinite(safe) || safe <= 0) return "0";
  if (Number.isInteger(safe) || Math.abs(safe - Math.round(safe)) < 1e-6) {
    return String(Math.round(safe));
  }
  if (safe < 1) return safe.toFixed(1);
  return String(Math.round(safe));
}

/** Nice Y-axis ceiling so ticks stay round (1 / 2 / 5 × 10^n). */
export function niceScaleMaxMinutes(value: number): number {
  const safe = Math.max(0, Number(value) || 0);
  if (safe <= 0) return 1;
  const padded = safe * 1.05;
  const magnitude = 10 ** Math.floor(Math.log10(padded));
  const normalized = padded / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return Math.max(1, Math.round(nice * magnitude));
}

export function buildPracticeStatsYTicks(scaleMaxMinutes: number): number[] {
  const top = Math.max(1, Math.round(scaleMaxMinutes));
  const mid = Math.round(top / 2);
  if (mid <= 0 || mid >= top) return [top, 0];
  return [top, mid, 0];
}

/** Center X of bar `index` when columns are `flex:1` with row `gap`. */
export function practiceStatsBarCenterX(
  index: number,
  barCount: number,
  plotWidth: number,
  gap: number,
): number {
  if (barCount <= 0 || plotWidth <= 0) return 0;
  const safeIndex = Math.max(0, Math.min(barCount - 1, index));
  const totalGap = gap * Math.max(0, barCount - 1);
  const columnWidth = (plotWidth - totalGap) / barCount;
  return safeIndex * (columnWidth + gap) + columnWidth / 2;
}

export function nearestPracticeStatsBarIndex(
  x: number,
  barCount: number,
  plotWidth: number,
  gap: number,
): number {
  if (barCount <= 0) return 0;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < barCount; index += 1) {
    const center = practiceStatsBarCenterX(index, barCount, plotWidth, gap);
    const distance = Math.abs(center - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

/** Prefer the latest day/week that has practice; else the last bar (today). */
export function defaultPracticeStatsSelectionIndex(bars?: Array<{ minutes: number }>): number {
  if (!bars?.length) return 0;
  for (let index = bars.length - 1; index >= 0; index -= 1) {
    if ((bars[index]?.minutes ?? 0) > 0) return index;
  }
  return bars.length - 1;
}

/** Place callout so one vertical edge touches the selection line. */
export function practiceStatsCalloutLeft(
  selectionX: number,
  calloutWidth: number,
  plotWidth: number,
): number {
  const width = Math.max(1, calloutWidth);
  if (selectionX + width <= plotWidth + 0.5) {
    return Math.max(0, selectionX);
  }
  return Math.max(0, Math.min(plotWidth - width, selectionX - width));
}

/** Long date for scrub callout (locale-aware via Luxon). */
export function formatPracticeStatsScrubDate(
  startLocalDate: string,
  endLocalDate: string,
  locale: string,
): string {
  const luxonLocale = locale === "ru" ? "ru" : locale;
  const start = DateTime.fromISO(startLocalDate, { zone: "utc" }).setLocale(luxonLocale);
  const end = DateTime.fromISO(endLocalDate, { zone: "utc" }).setLocale(luxonLocale);
  if (!start.isValid) return startLocalDate;
  if (!end.isValid || startLocalDate === endLocalDate) {
    return start.toFormat("d MMMM yyyy");
  }
  if (start.year === end.year && start.month === end.month) {
    return `${start.toFormat("d")}–${end.toFormat("d MMMM yyyy")}`;
  }
  if (start.year === end.year) {
    return `${start.toFormat("d MMM")} – ${end.toFormat("d MMM yyyy")}`;
  }
  return `${start.toFormat("d MMM yyyy")} – ${end.toFormat("d MMM yyyy")}`;
}

function listLocalDates(fromLocalDate: string, throughLocalDate: string): string[] {
  const start = DateTime.fromISO(fromLocalDate, { zone: "utc" }).startOf("day");
  const end = DateTime.fromISO(throughLocalDate, { zone: "utc" }).startOf("day");
  if (!start.isValid || !end.isValid || end < start) return [];
  const dates: string[] = [];
  for (let cursor = start; cursor <= end; cursor = cursor.plus({ days: 1 })) {
    dates.push(cursor.toFormat("yyyy-MM-dd"));
  }
  return dates;
}

function pickLabelIndices(count: number, preferredTicks: number): Set<number> {
  if (count <= 0) return new Set();
  if (count <= preferredTicks) {
    return new Set(Array.from({ length: count }, (_, index) => index));
  }
  const ticks = Math.max(2, preferredTicks);
  const indices = new Set<number>();
  for (let i = 0; i < ticks; i += 1) {
    indices.add(Math.round((i * (count - 1)) / (ticks - 1)));
  }
  return indices;
}

function buildDayBars(dailyMinutes: Map<string, number>, dates: string[]): PracticeStatsBar[] {
  const values = dates.map((date) => dailyMinutes.get(date) ?? 0);
  const labelIndices = pickLabelIndices(dates.length, dates.length <= 8 ? dates.length : 5);

  return dates.map((date, index) => {
    const minutes = values[index] ?? 0;
    return {
      key: date,
      minutes,
      startLocalDate: date,
      endLocalDate: date,
      showValue: false,
      showDateLabel: labelIndices.has(index),
      dateLabel: formatPracticeStatsDate(date),
    };
  });
}

function buildWeekBars(dailyMinutes: Map<string, number>, dates: string[]): PracticeStatsBar[] {
  const bars: PracticeStatsBar[] = [];
  for (let offset = 0; offset < dates.length; offset += 7) {
    const chunk = dates.slice(offset, offset + 7);
    if (!chunk.length) continue;
    const startLocalDate = chunk[0]!;
    const endLocalDate = chunk[chunk.length - 1]!;
    const totalMinutes = chunk.reduce((sum, date) => sum + (dailyMinutes.get(date) ?? 0), 0);
    // Не Math.round: 1 мин за неделю → round(1/7)=0 и график ошибочно «пустой».
    const minutes = chunk.length > 0 ? totalMinutes / chunk.length : 0;
    bars.push({
      key: `${startLocalDate}_${endLocalDate}`,
      minutes,
      startLocalDate,
      endLocalDate,
      showValue: false,
      showDateLabel: false,
      dateLabel: formatPracticeStatsDate(startLocalDate),
    });
  }

  const labelIndices = pickLabelIndices(bars.length, bars.length <= 8 ? bars.length : 5);
  return bars.map((bar, index) => ({
    ...bar,
    showDateLabel: labelIndices.has(index),
  }));
}

export function buildPracticeStatsChartModel(input: {
  rows: PracticeStatsSourceRow[];
  periodDays: number;
  timezone: string;
  now?: DateTime<boolean>;
}): PracticeStatsChartModel {
  const periodDays = Math.max(1, Math.floor(input.periodDays));
  const { fromLocalDate, throughLocalDate } = practiceStatsLocalWindow(
    periodDays,
    input.timezone,
    input.now ?? DateTime.utc(),
  );
  const dates = listLocalDates(fromLocalDate, throughLocalDate);
  const dailyMinutes = new Map<string, number>();
  for (const row of input.rows) {
    const date = row.local_date?.trim();
    if (!date) continue;
    dailyMinutes.set(date, secondsToPracticeMinutes(row.total_practice_seconds));
  }

  const mode: "day" | "week" = periodDays >= 90 ? "week" : "day";
  const bars =
    mode === "week" ? buildWeekBars(dailyMinutes, dates) : buildDayBars(dailyMinutes, dates);

  const maxMinutes = Math.max(0, ...bars.map((bar) => bar.minutes));
  const scaleMaxMinutes = niceScaleMaxMinutes(Math.max(1, maxMinutes));
  // По сырым дням: недельное среднее <0.5 иначе округлялось к 0 и прятало практику.
  const hasAnyPractice = Array.from(dailyMinutes.values()).some((minutes) => minutes > 0);

  return {
    mode,
    bars,
    maxMinutes,
    scaleMaxMinutes,
    yTicks: buildPracticeStatsYTicks(scaleMaxMinutes),
    hasAnyPractice,
    fromLocalDate,
    throughLocalDate,
  };
}
