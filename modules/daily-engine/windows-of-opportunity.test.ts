import { describe, expect, it } from "vitest";

import { computeWindowsForFreeUser } from "./freeWindows";

function hourInTimezone(value: string, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      hour12: false,
    }).format(new Date(value)),
  );
}

describe("windows of opportunity", () => {
  it("keeps Moscow sunrise for the Sun in morning hours", () => {
    const windows = computeWindowsForFreeUser({
      primaryPlanet: "Sun",
      userLocation: { lat: 55.7558, lng: 37.6173, timezone: "Europe/Moscow" },
      forecastDate: "2026-05-22",
    });

    expect(windows.sunrise?.time).toBeTruthy();
    expect(windows.culmination?.time).toBeTruthy();

    const sunriseHour = hourInTimezone(windows.sunrise!.time, "Europe/Moscow");
    const culminationHour = hourInTimezone(windows.culmination!.time, "Europe/Moscow");

    expect(sunriseHour).toBeGreaterThanOrEqual(3);
    expect(sunriseHour).toBeLessThanOrEqual(7);
    expect(culminationHour).toBeGreaterThanOrEqual(11);
    expect(culminationHour).toBeLessThanOrEqual(15);
    expect(new Date(windows.culmination!.time).getTime()).toBeGreaterThan(new Date(windows.sunrise!.time).getTime());
  });
});
