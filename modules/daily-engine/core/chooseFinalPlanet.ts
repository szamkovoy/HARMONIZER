import { PLANETS_7 } from "../../astro-core";
import type { Planet } from "./types";

const KNOWN_PLANETS = new Set<string>(PLANETS_7);

/** Calendar dates [yesterday, day-before] for a `YYYY-MM-DD` forecast date. */
export function priorForecastDates(forecastDate: string): [string, string] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(forecastDate);
  if (!match) return ["", ""];
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const iso = (daysBack: number) => {
    const next = new Date(utc);
    next.setUTCDate(next.getUTCDate() - daysBack);
    return next.toISOString().slice(0, 10);
  };
  return [iso(1), iso(2)];
}

/**
 * `[день−1, день−2]` from stored forecast rows.
 * A missing day is omitted, so a gap breaks the three-day streak.
 */
export function recentPlanetsFromHistory(
  forecastDate: string,
  rows: Array<{
    forecast_date?: string | null;
    forecastDate?: string | null;
    planet_of_the_day?: string | null;
    planetOfTheDay?: string | null;
  }>,
): Planet[] {
  const [yesterday, dayBefore] = priorForecastDates(forecastDate);
  const byDate = new Map<string, Planet>();
  for (const row of rows) {
    const date = String(row.forecast_date ?? row.forecastDate ?? "").slice(0, 10);
    const planet = String(row.planet_of_the_day ?? row.planetOfTheDay ?? "");
    if (date && KNOWN_PLANETS.has(planet)) byDate.set(date, planet as Planet);
  }
  const recent: Planet[] = [];
  for (const date of [yesterday, dayBefore]) {
    const planet = byDate.get(date);
    if (planet) recent.push(planet);
  }
  return recent;
}

/** True when a stored day still shows the same planet as the two previous calendar days. */
export function forecastRepeatsPreviousDays(
  planetOfTheDay: string | null | undefined,
  isAlternativeChoice: boolean,
  recentPlanetsOfDay: readonly string[],
): boolean {
  if (isAlternativeChoice || !planetOfTheDay) return false;
  const [previousDay, dayBefore] = recentPlanetsOfDay;
  return previousDay === planetOfTheDay && dayBefore === planetOfTheDay;
}

export function rankPlanets(importance: Record<Planet, number>): Planet[] {
  return [...PLANETS_7].sort((a, b) => importance[b] - importance[a]);
}

export function chooseFinalPlanet(params: {
  rankedPlanets: Planet[];
  recentPlanetsOfDay: Planet[];
}): {
  planetOfTheDay: Planet;
  isAlternativeChoice: boolean;
  alternativeReasonText?: string;
} {
  const firstChoice = params.rankedPlanets[0];
  const [previousDay, dayBefore] = params.recentPlanetsOfDay;

  if (previousDay === firstChoice && dayBefore === firstChoice && params.rankedPlanets[1]) {
    const planetOfTheDay = params.rankedPlanets[1];
    return {
      planetOfTheDay,
      isAlternativeChoice: true,
      alternativeReasonText:
        "Сегодня предлагаем направить внимание на другую тему. Это разнообразит ваши усилия по гармонизации.",
    };
  }

  return {
    planetOfTheDay: firstChoice,
    isAlternativeChoice: false,
  };
}
