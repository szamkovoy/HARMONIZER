import { PLANETS_7 } from "@/modules/astro-core";
import type { DailyForecast, Planet } from "./core/types";
import { computeDiurnalWindowTimes } from "./planetDiurnalCurve";

function isPlanet(value: unknown): value is Planet {
  return typeof value === "string" && (PLANETS_7 as readonly string[]).includes(value);
}

export function computeWindowsForFreeUser(params: {
  primaryPlanet: Planet;
  userLocation: { lat: number; lng: number; timezone: string };
  forecastDate: string;
}): DailyForecast["windowsOfOpportunity"] {
  const { sunrise: riseTime, culmination: culminationTime } = computeDiurnalWindowTimes({
    planet: params.primaryPlanet,
    forecastDate: params.forecastDate,
    userLocation: params.userLocation,
  });

  return {
    sunrise: riseTime ? { time: riseTime, planet: params.primaryPlanet } : null,
    culmination: culminationTime ? { time: culminationTime, planet: params.primaryPlanet } : null,
    exactAspect: null,
  };
}
