import { describe, expect, it } from "vitest";

import { eclipticLongitudeForPlanetAt } from "./ephemeris";

function angularDeltaDegrees(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return Math.min(raw, 360 - raw);
}

describe("solar ephemeris", () => {
  it("changes smoothly over short intervals", () => {
    const first = eclipticLongitudeForPlanetAt("Sun", new Date("2026-05-21T21:00:00.000Z"));
    const second = eclipticLongitudeForPlanetAt("Sun", new Date("2026-05-21T21:10:00.000Z"));
    const third = eclipticLongitudeForPlanetAt("Sun", new Date("2026-05-21T21:20:00.000Z"));

    expect(angularDeltaDegrees(first, second)).toBeLessThan(0.02);
    expect(angularDeltaDegrees(second, third)).toBeLessThan(0.02);
  });
});
