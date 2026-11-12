import { DateTime } from "luxon";

import { eclipticLongitudeForPlanetAt } from "@/modules/astro-core";
import { angularDistance } from "./core/aspects";

const TEN_MINUTES_MS = 10 * 60 * 1000;
/**
 * Максимальный орб сизигии (отклонение углового расстояния Солнце–Луна от 0°
 * или 180°), при котором момент считается попадающим в текущие локальные сутки.
 * Луна движется ~13°/сутки (~0,5°/час), поэтому 0,1° соответствует ~12 минутам —
 * достаточно, чтобы отличить «сизигия сегодня» от «сизигия в соседние сутки».
 */
const SYZYGY_MAX_ORB_DEG = 0.1;

export type MoonPhaseKind = "new" | "full";

export interface MoonPhaseEvent {
  kind: MoonPhaseKind;
  /** ISO-момент максимальной фазы в timezone пользователя. */
  time: string;
}

function localDayBoundsMs(forecastDate: string, timezone: string): { start: number; end: number } {
  const start = DateTime.fromISO(forecastDate, { zone: timezone }).startOf("day");
  return {
    start: start.toUTC().toMillis(),
    end: start.plus({ days: 1 }).toUTC().toMillis(),
  };
}

function syzygyOrbAt(date: Date, target: 0 | 180): number {
  const sunLon = eclipticLongitudeForPlanetAt("Sun", date);
  const moonLon = eclipticLongitudeForPlanetAt("Moon", date);
  return Math.abs(angularDistance(sunLon, moonLon) - target);
}

/**
 * Грубый поиск минимума орба по 10-минутной сетке внутри суток, затем тернарная
 * доводка на НЕзажатом окне вокруг лучшего сэмпла — чтобы поймать сизигию, точно
 * лежащую в границах дня, и отбросить сизигию из соседних суток.
 */
function refineSyzygy(start: number, end: number, target: 0 | 180): { time: number; orb: number } {
  let best = { t: start, orb: Number.POSITIVE_INFINITY };
  for (let t = start; t <= end; t += TEN_MINUTES_MS) {
    const orb = syzygyOrbAt(new Date(t), target);
    if (orb < best.orb) best = { t, orb };
  }

  let lo = best.t - TEN_MINUTES_MS;
  let hi = best.t + TEN_MINUTES_MS;
  for (let i = 0; i < 24; i += 1) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const o1 = syzygyOrbAt(new Date(m1), target);
    const o2 = syzygyOrbAt(new Date(m2), target);
    if (o1 < o2) hi = m2;
    else lo = m1;
  }
  const time = (lo + hi) / 2;
  const orb = syzygyOrbAt(new Date(time), target);
  return { time, orb };
}

/**
 * Момент новолуния (Δ Солнце–Луна = 0°) или полнолуния (Δ = 180°), если он
 * попадает в текущие локальные сутки пользователя.
 *
 * Сизигия глобальна — наступает одновременно на всей планете и не зависит от
 * lat/lng. Только timezone пользователя решает, в какой календарный день она
 * попадает и, следовательно, показывать ли строку в «Окнах возможностей».
 */
export function computeMoonPhaseForLocalDay(params: {
  forecastDate: string;
  timezone: string;
}): MoonPhaseEvent | null {
  const { start, end } = localDayBoundsMs(params.forecastDate, params.timezone);

  const candidates = [
    { kind: "new" as const, ...refineSyzygy(start, end, 0) },
    { kind: "full" as const, ...refineSyzygy(start, end, 180) },
  ].filter((c) => c.orb <= SYZYGY_MAX_ORB_DEG && c.time >= start && c.time <= end);

  if (candidates.length === 0) return null;
  // В одни сутки двух сизигий быть не может (они разделены ~14,77 дня),
  // но defensively берём ближайшую к точному моменту.
  candidates.sort((a, b) => a.orb - b.orb);
  const chosen = candidates[0];
  return {
    kind: chosen.kind,
    time: DateTime.fromMillis(chosen.time, { zone: "utc" }).setZone(params.timezone).toISO()!,
  };
}
