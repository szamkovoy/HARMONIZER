import { describe, expect, it } from "vitest";
import {
  forecastRepeatsPreviousDays,
  priorForecastDates,
  recentPlanetsFromHistory,
} from "./core/chooseFinalPlanet";

describe("recent planets of the day", () => {
  it("steps back across month and year boundaries", () => {
    expect(priorForecastDates("2026-03-01")).toEqual(["2026-02-28", "2026-02-27"]);
    expect(priorForecastDates("2024-03-01")).toEqual(["2024-02-29", "2024-02-28"]);
    expect(priorForecastDates("2026-01-01")).toEqual(["2025-12-31", "2025-12-30"]);
  });

  it("reads yesterday then the day before, and a gap does not impersonate a day", () => {
    const rows = [
      { forecast_date: "2026-11-07", planet_of_the_day: "Sun" },
      { forecast_date: "2026-11-08", planet_of_the_day: "Sun" },
    ];
    expect(recentPlanetsFromHistory("2026-11-09", rows)).toEqual(["Sun", "Sun"]);
    expect(recentPlanetsFromHistory("2026-11-09", [rows[1]])).toEqual(["Sun"]);
    expect(recentPlanetsFromHistory("2026-11-09", [{ forecast_date: "2026-11-07", planet_of_the_day: "Sun" }])).toEqual([
      "Sun",
    ]);
  });

  it("ignores unknown planet names", () => {
    expect(
      recentPlanetsFromHistory("2026-11-09", [
        { forecast_date: "2026-11-08", planet_of_the_day: "Pluto" },
        { forecast_date: "2026-11-07", planet_of_the_day: "Saturn" },
      ]),
    ).toEqual(["Saturn"]);
  });

  it("flags a stored day that repeats the two previous planets", () => {
    expect(forecastRepeatsPreviousDays("Sun", false, ["Sun", "Sun"])).toBe(true);
    expect(forecastRepeatsPreviousDays("Sun", true, ["Sun", "Sun"])).toBe(false);
    expect(forecastRepeatsPreviousDays("Sun", false, ["Sun"])).toBe(false);
    expect(forecastRepeatsPreviousDays("Saturn", false, ["Sun", "Sun"])).toBe(false);
  });
});
