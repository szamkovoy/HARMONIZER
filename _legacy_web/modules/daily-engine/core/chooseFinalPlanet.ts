import { PLANETS_7 } from "../../astro-core";
import type { Planet } from "./types";

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
