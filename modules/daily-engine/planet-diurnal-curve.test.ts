import { describe, expect, it } from "vitest";

import { interpolateDiurnalAltitude, samplePlanetAltitudeForDay } from "./planetDiurnalCurve";

describe("planetDiurnalCurve", () => {
  it("forms a continuous full-day cycle for the Sun in Moscow", () => {
    const samples = samplePlanetAltitudeForDay({
      planet: "Sun",
      forecastDate: "2026-05-22",
      userLocation: { lat: 55.7558, lng: 37.6173, timezone: "Europe/Moscow" },
      steps: 96,
    });

    expect(samples[0].x).toBe(0);
    expect(samples[samples.length - 1].x).toBe(1);

    for (let i = 1; i < samples.length; i += 1) {
      expect(Math.abs(samples[i].altitude - samples[i - 1].altitude)).toBeLessThan(0.2);
    }

    expect(Math.abs(samples[0].altitude - samples[samples.length - 1].altitude)).toBeLessThan(0.05);

    const maxAltitude = Math.max(...samples.map((sample) => sample.altitude));
    expect(maxAltitude).toBeGreaterThan(0.3);
    expect(interpolateDiurnalAltitude(samples, 0)).toBeCloseTo(samples[0].altitude, 5);
    expect(interpolateDiurnalAltitude(samples, 1)).toBeCloseTo(samples[samples.length - 1].altitude, 5);
  });
});
