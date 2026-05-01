import { DateTime } from "luxon";
import sidereal from "astronomia/sidereal";
import julian from "astronomia/julian";

import { equatorialForPlanetAt, PLANETS_7 } from "@/modules/astro-core";
import type { AspectType, DailyForecast, Planet } from "./core/types";

const DEG_TO_RAD = Math.PI / 180;
const TEN_MINUTES_MS = 10 * 60 * 1000;

export type FreeUserTopAspect = {
  from: Planet;
  to: Planet;
  type: AspectType;
  exact_at?: string | null;
} | null;

function isPlanet(value: unknown): value is Planet {
  return typeof value === "string" && (PLANETS_7 as readonly string[]).includes(value);
}

function toJulianDay(date: Date): number {
  return new julian.Calendar(date).toJD();
}

function localDayBounds(forecastDate: string, timezone: string): { start: Date; end: Date } {
  const start = DateTime.fromISO(forecastDate, { zone: timezone }).startOf("day");
  return {
    start: start.toUTC().toJSDate(),
    end: start.plus({ days: 1 }).toUTC().toJSDate(),
  };
}

function altitudeAt(planet: Planet, date: Date, lat: number, lng: number): number {
  const eq = equatorialForPlanetAt(planet, date);
  const theta = (sidereal.apparent(toJulianDay(date)) / 240) * DEG_TO_RAD;
  const localSidereal = theta + lng * DEG_TO_RAD;
  const hourAngle = localSidereal - eq.ra;
  const phi = lat * DEG_TO_RAD;
  return Math.asin(Math.sin(phi) * Math.sin(eq.dec) + Math.cos(phi) * Math.cos(eq.dec) * Math.cos(hourAngle));
}

function interpolateCrossing(a: { t: number; altitude: number }, b: { t: number; altitude: number }): Date {
  const ratio = Math.abs(a.altitude) / (Math.abs(a.altitude) + Math.abs(b.altitude));
  return new Date(a.t + (b.t - a.t) * ratio);
}

function computeRiseTime(planet: Planet, userLocation: { lat: number; lng: number; timezone: string }, forecastDate: string): string | null {
  const { start, end } = localDayBounds(forecastDate, userLocation.timezone);
  let previous = {
    t: start.getTime(),
    altitude: altitudeAt(planet, start, userLocation.lat, userLocation.lng),
  };

  for (let t = previous.t + TEN_MINUTES_MS; t <= end.getTime(); t += TEN_MINUTES_MS) {
    const current = {
      t,
      altitude: altitudeAt(planet, new Date(t), userLocation.lat, userLocation.lng),
    };
    if (previous.altitude < 0 && current.altitude >= 0) {
      return DateTime.fromJSDate(interpolateCrossing(previous, current), { zone: "utc" })
        .setZone(userLocation.timezone)
        .toISO();
    }
    previous = current;
  }
  return null;
}

function computeCulminationTime(planet: Planet, userLocation: { lat: number; lng: number; timezone: string }, forecastDate: string): string | null {
  const { start, end } = localDayBounds(forecastDate, userLocation.timezone);
  let best: { t: number; altitude: number } | null = null;
  for (let t = start.getTime(); t <= end.getTime(); t += TEN_MINUTES_MS) {
    const altitude = altitudeAt(planet, new Date(t), userLocation.lat, userLocation.lng);
    if (!best || altitude > best.altitude) best = { t, altitude };
  }
  if (!best || best.altitude < 0) return null;
  return DateTime.fromMillis(best.t, { zone: "utc" }).setZone(userLocation.timezone).toISO();
}

export function computeWindowsForFreeUser(params: {
  primaryPlanet: Planet;
  topAspect: FreeUserTopAspect;
  userLocation: { lat: number; lng: number; timezone: string };
  forecastDate: string;
}): DailyForecast["windowsOfOpportunity"] {
  const riseTime = computeRiseTime(params.primaryPlanet, params.userLocation, params.forecastDate);
  const culminationTime = computeCulminationTime(params.primaryPlanet, params.userLocation, params.forecastDate);
  const exactDate = params.topAspect?.exact_at ? new Date(params.topAspect.exact_at) : null;
  const exactLocal = exactDate && !Number.isNaN(exactDate.getTime())
    ? DateTime.fromJSDate(exactDate, { zone: "utc" }).setZone(params.userLocation.timezone)
    : null;

  return {
    sunrise: riseTime ? { time: riseTime, planet: params.primaryPlanet } : null,
    culmination: culminationTime ? { time: culminationTime, planet: params.primaryPlanet } : null,
    exactAspect:
      params.topAspect && exactLocal?.toISO() && isPlanet(params.topAspect.to)
        ? {
            time: exactLocal.toISO()!,
            aspectType: params.topAspect.type,
            toNatalPlanet: params.topAspect.to,
          }
        : null,
  };
}
