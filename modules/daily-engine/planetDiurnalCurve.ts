import { DateTime } from "luxon";
import sidereal from "astronomia/sidereal";
import julian from "astronomia/julian";

import { equatorialForPlanetAt } from "@/modules/astro-core";
import type { Planet } from "./core/types";

const DEG_TO_RAD = Math.PI / 180;

export type DiurnalAltitudeSample = {
  /** Доля локальных суток 0…1 от полуночи до следующей полуночи. */
  x: number;
  /** Высота над горизонтом, радианы. */
  altitude: number;
};

function toJulianDay(date: Date): number {
  return new julian.Calendar(date).toJD();
}

export function planetAltitudeAt(planet: Planet, date: Date, lat: number, lng: number): number {
  const eq = equatorialForPlanetAt(planet, date);
  const theta = (sidereal.apparent(toJulianDay(date)) / 240) * DEG_TO_RAD;
  const localSidereal = theta + lng * DEG_TO_RAD;
  const hourAngle = localSidereal - eq.ra;
  const phi = lat * DEG_TO_RAD;
  return Math.asin(Math.sin(phi) * Math.sin(eq.dec) + Math.cos(phi) * Math.cos(eq.dec) * Math.cos(hourAngle));
}

/** Равномерная выборка высоты планеты за локальные сутки прогноза (полный цикл 0…1). */
export function samplePlanetAltitudeForDay(params: {
  planet: Planet;
  forecastDate: string;
  userLocation: { lat: number; lng: number; timezone: string };
  steps?: number;
}): DiurnalAltitudeSample[] {
  const steps = params.steps ?? 96;
  const start = DateTime.fromISO(params.forecastDate, { zone: params.userLocation.timezone }).startOf("day");
  const dayMs = 24 * 60 * 60 * 1000;
  const { lat, lng } = params.userLocation;

  return Array.from({ length: steps + 1 }, (_, index) => {
    const x = index / steps;
    const instant = new Date(start.toUTC().toMillis() + x * dayMs);
    return {
      x,
      altitude: planetAltitudeAt(params.planet, instant, lat, lng),
    };
  });
}

export function interpolateDiurnalAltitude(samples: DiurnalAltitudeSample[], x: number): number {
  if (samples.length === 0) return 0;
  if (samples.length === 1) return samples[0].altitude;
  const clamped = Math.min(1, Math.max(0, x));
  const position = clamped * (samples.length - 1);
  const i0 = Math.floor(position);
  const i1 = Math.min(samples.length - 1, i0 + 1);
  const frac = position - i0;
  return samples[i0].altitude * (1 - frac) + samples[i1].altitude * frac;
}

/** Доля суток 0…1 для ISO-момента в IANA-зоне (та же шкала, что у `samplePlanetAltitudeForDay`). */
export function dayFractionFromIso(timeIso: string, timezone: string): number | null {
  const dt = DateTime.fromISO(timeIso, { zone: timezone });
  if (!dt.isValid) return null;
  const start = dt.startOf("day");
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.min(1, Math.max(0, dt.diff(start).as("milliseconds") / dayMs));
}

function isoFromDayFraction(x: number, forecastDate: string, timezone: string): string {
  const start = DateTime.fromISO(forecastDate, { zone: timezone }).startOf("day");
  return start.plus({ milliseconds: x * 24 * 60 * 60 * 1000 }).toUTC().toISO()!;
}

/** Первое пересечение горизонта (altitude < 0 → ≥ 0) по сэмплам суточной кривой. */
export function findSunriseDayFraction(samples: DiurnalAltitudeSample[]): number | null {
  for (let i = 0; i < samples.length - 1; i += 1) {
    const a = samples[i];
    const b = samples[i + 1];
    if (a.altitude < 0 && b.altitude >= 0) {
      const ratio = Math.abs(a.altitude) / (Math.abs(a.altitude) + Math.abs(b.altitude));
      return a.x + (b.x - a.x) * ratio;
    }
  }
  return null;
}

/** Кульминация: максимум высоты с параболической подстройкой между соседними сэмплами. */
export function findCulminationDayFraction(samples: DiurnalAltitudeSample[]): number | null {
  if (samples.length === 0) return null;
  let bestIndex = 0;
  for (let i = 1; i < samples.length; i += 1) {
    if (samples[i].altitude > samples[bestIndex].altitude) bestIndex = i;
  }
  if (samples[bestIndex].altitude < 0) return null;
  if (bestIndex === 0 || bestIndex === samples.length - 1) return samples[bestIndex].x;

  const a = samples[bestIndex - 1];
  const b = samples[bestIndex];
  const c = samples[bestIndex + 1];
  const denom = a.altitude - 2 * b.altitude + c.altitude;
  if (Math.abs(denom) < 1e-12) return b.x;
  const stepX = b.x - a.x;
  const offset = 0.5 * (a.altitude - c.altitude) / denom;
  return Math.min(c.x, Math.max(a.x, b.x + offset * stepX));
}

/** Восход и кульминация из той же дискретизации, что и график (по умолчанию 96 шагов/сутки). */
export function computeDiurnalWindowTimes(params: {
  planet: Planet;
  forecastDate: string;
  userLocation: { lat: number; lng: number; timezone: string };
  steps?: number;
}): { sunrise: string | null; culmination: string | null } {
  const samples = samplePlanetAltitudeForDay(params);
  const riseX = findSunriseDayFraction(samples);
  const culmX = findCulminationDayFraction(samples);
  const { forecastDate, userLocation } = params;
  return {
    sunrise: riseX != null ? isoFromDayFraction(riseX, forecastDate, userLocation.timezone) : null,
    culmination: culmX != null ? isoFromDayFraction(culmX, forecastDate, userLocation.timezone) : null,
  };
}
