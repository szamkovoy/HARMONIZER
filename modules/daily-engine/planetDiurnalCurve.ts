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
