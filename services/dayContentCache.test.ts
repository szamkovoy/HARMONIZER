import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  Platform: { OS: "web" },
}));

import {
  loadDayContentCache,
  loadDayContentCacheRelaxed,
  saveDayContentCache,
} from "./dayContentCache";

const locA = { lat: 59.9346462, lng: 30.2990411, timezone: "Europe/Moscow" };
/** ~80 m east — must still count as the same place (old epsilon ~11 m failed here). */
const locNearby = { lat: 59.9346462, lng: 30.3004, timezone: "Europe/Moscow" };
/** ~5 km east — strict miss, but today's row must stay for relaxed reads. */
const locFar = { lat: 59.9346462, lng: 30.39, timezone: "Europe/Moscow" };

const forecast = {
  date: "2026-09-05",
  importance: {
    Sun: 0,
    Moon: 0,
    Mercury: 0,
    Venus: 0,
    Mars: 1,
    Jupiter: 0,
    Saturn: 0,
  },
  activation: {
    Sun: 0,
    Moon: 0,
    Mercury: 0,
    Venus: 0,
    Mars: 1,
    Jupiter: 0,
    Saturn: 0,
  },
  rankedPlanets: ["Mars", "Sun", "Moon", "Mercury", "Venus", "Jupiter", "Saturn"],
  planetOfTheDay: "Mars",
  isAlternativeChoice: false,
  todayPlanetState: {
    naturalHarmoniousness: 0.5,
    todayTone: "harmonic",
  },
  windowsOfOpportunity: {
    sunrise: null,
    culmination: null,
    exactAspect: null,
  },
  transitChart: {
    referenceTime: "2026-09-05T12:00:00Z",
    planets: {} as never,
  },
  computedAt: "2026-09-05T00:00:06.000Z",
  cacheValidUntil: "2099-01-01T00:00:00.000Z",
};

describe("dayContentCache GPS jitter", () => {
  it("treats GPS jitter as the same place and does not drop the row on a larger drift", async () => {
    const userId = `cache-jitter-${Date.now()}`;
    const lookup = {
      userId,
      accessMode: "premium" as const,
      accessTier: "master" as const,
      forecastDate: "2026-09-05",
      scopeKey: "natal:en",
    };

    await saveDayContentCache({
      ...lookup,
      userLocation: locA,
      content: { forecast: forecast as never, source: "cache", modelUsed: "test" },
    });

    const nearby = await loadDayContentCache({
      ...lookup,
      userLocation: locNearby,
      allowStale: true,
    });
    expect(nearby?.freshness).toBe("fresh");

    const strictFar = await loadDayContentCache({
      ...lookup,
      userLocation: locFar,
      allowStale: true,
    });
    expect(strictFar).toBeNull();

    const relaxed = await loadDayContentCacheRelaxed({
      ...lookup,
      allowStale: true,
    });
    expect(relaxed?.freshness).toBe("fresh");
    expect(relaxed?.forecast.planetOfTheDay).toBe("Mars");
  });
});
