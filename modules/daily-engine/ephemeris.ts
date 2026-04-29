import { DateTime } from "luxon";
import sidereal from "astronomia/sidereal";
import julian from "astronomia/julian";
import { ASPECT_EXACT_ANGLE } from "./core/constants";
import { angularDistance } from "./core/aspects";
import { computeDailyForecast, type TransitProvider } from "./computeDailyForecast";
import type { DailyEngineInput, DailyForecast, Planet, TransitChart, WindowComputationContext } from "./core/types";
import { PLANETS_7, eclipticLongitudeForPlanetAt, equatorialForPlanetAt, positionForPlanetAt } from "../astro-core";

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const TEN_MINUTES_MS = 10 * 60 * 1000;

function localReferenceDate(input: DailyEngineInput): Date {
  return DateTime.fromISO(`${input.forecastDate}T14:00`, {
    zone: input.userLocation.timezone,
  })
    .toUTC()
    .toJSDate();
}

function localDayBounds(input: DailyEngineInput): { start: Date; end: Date } {
  const start = DateTime.fromISO(input.forecastDate, {
    zone: input.userLocation.timezone,
  }).startOf("day");
  return {
    start: start.toUTC().toJSDate(),
    end: start.plus({ days: 1 }).toUTC().toJSDate(),
  };
}

function toJulianDay(date: Date): number {
  return new julian.Calendar(date).toJD();
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

function computeRiseTime(input: DailyEngineInput, planet: Planet): string | null {
  const { start, end } = localDayBounds(input);
  let previous = {
    t: start.getTime(),
    altitude: altitudeAt(planet, start, input.userLocation.lat, input.userLocation.lng),
  };

  for (let t = previous.t + TEN_MINUTES_MS; t <= end.getTime(); t += TEN_MINUTES_MS) {
    const current = {
      t,
      altitude: altitudeAt(planet, new Date(t), input.userLocation.lat, input.userLocation.lng),
    };

    if (previous.altitude < 0 && current.altitude >= 0) {
      return DateTime.fromJSDate(interpolateCrossing(previous, current), { zone: "utc" })
        .setZone(input.userLocation.timezone)
        .toISO();
    }
    previous = current;
  }

  return null;
}

function computeCulminationTime(input: DailyEngineInput, planet: Planet): string | null {
  const { start, end } = localDayBounds(input);
  let best: { t: number; altitude: number } | null = null;

  for (let t = start.getTime(); t <= end.getTime(); t += TEN_MINUTES_MS) {
    const altitude = altitudeAt(planet, new Date(t), input.userLocation.lat, input.userLocation.lng);
    if (!best || altitude > best.altitude) best = { t, altitude };
  }

  if (!best || best.altitude < 0) return null;
  return DateTime.fromMillis(best.t, { zone: "utc" }).setZone(input.userLocation.timezone).toISO();
}

function exactAspectOrbAt(params: {
  transitPlanet: Planet;
  natalLongitude: number;
  exactAngle: number;
  date: Date;
}): number {
  const longitude = eclipticLongitudeForPlanetAt(params.transitPlanet, params.date);
  return Math.abs(angularDistance(longitude, params.natalLongitude) - params.exactAngle);
}

function computeExactAspectTime(input: DailyEngineInput, context: WindowComputationContext): string | null {
  const { start, end } = localDayBounds(input);
  const natalLongitude = input.natalProfile.planets[context.planetOfTheDay].longitude;
  const exactAngle = ASPECT_EXACT_ANGLE[context.mainAspect.type];
  let best = { t: start.getTime(), orb: Number.POSITIVE_INFINITY };

  for (let t = start.getTime(); t <= end.getTime(); t += TEN_MINUTES_MS) {
    const orb = exactAspectOrbAt({
      transitPlanet: context.mainTransitPlanet,
      natalLongitude,
      exactAngle,
      date: new Date(t),
    });
    if (orb < best.orb) best = { t, orb };
  }

  // Refine around the best coarse sample by ternary search.
  let lo = Math.max(start.getTime(), best.t - TEN_MINUTES_MS);
  let hi = Math.min(end.getTime(), best.t + TEN_MINUTES_MS);
  for (let i = 0; i < 24; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const o1 = exactAspectOrbAt({
      transitPlanet: context.mainTransitPlanet,
      natalLongitude,
      exactAngle,
      date: new Date(m1),
    });
    const o2 = exactAspectOrbAt({
      transitPlanet: context.mainTransitPlanet,
      natalLongitude,
      exactAngle,
      date: new Date(m2),
    });
    if (o1 < o2) hi = m2;
    else lo = m1;
  }

  const exactTime = (lo + hi) / 2;
  const finalOrb = exactAspectOrbAt({
    transitPlanet: context.mainTransitPlanet,
    natalLongitude,
    exactAngle,
    date: new Date(exactTime),
  });

  if (finalOrb > 0.1) return null;
  return DateTime.fromMillis(exactTime, { zone: "utc" }).setZone(input.userLocation.timezone).toISO();
}

export class AstronomiaTransitProvider implements TransitProvider {
  computeTransitChart(input: DailyEngineInput): TransitChart {
    const referenceDate = localReferenceDate(input);
    const planets = Object.fromEntries(
      PLANETS_7.map((planet) => [planet, positionForPlanetAt(planet, referenceDate)]),
    ) as TransitChart["planets"];

    return {
      referenceTime: DateTime.fromJSDate(referenceDate, { zone: "utc" }).setZone(input.userLocation.timezone).toISO()!,
      planets,
    };
  }

  computeWindowsOfOpportunity(
    input: DailyEngineInput,
    context: WindowComputationContext,
  ): DailyForecast["windowsOfOpportunity"] {
    const riseTime = computeRiseTime(input, context.mainTransitPlanet);
    const culminationTime = computeCulminationTime(input, context.mainTransitPlanet);
    const exactAspectTime = computeExactAspectTime(input, context);

    return {
      sunrise: riseTime ? { time: riseTime, planet: context.mainTransitPlanet } : null,
      culmination: culminationTime ? { time: culminationTime, planet: context.mainTransitPlanet } : null,
      exactAspect: exactAspectTime
        ? {
            time: exactAspectTime,
            aspectType: context.mainAspect.type,
            toNatalPlanet: context.planetOfTheDay,
          }
        : null,
    };
  }
}

export async function computeDailyForecastWithAstronomia(input: DailyEngineInput): Promise<DailyForecast> {
  return computeDailyForecast(input, new AstronomiaTransitProvider());
}
