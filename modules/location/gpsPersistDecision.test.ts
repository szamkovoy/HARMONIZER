import { describe, expect, it } from "vitest";

import { metersBetweenCoords, shouldPersistGpsUpdate } from "./gpsPersistDecision";

describe("shouldPersistGpsUpdate", () => {
  const base = { lat: 59.9346462, lng: 30.2990411, timezone: "Europe/Moscow" };

  it("persists the first fix", () => {
    expect(shouldPersistGpsUpdate(null, base)).toBe(true);
  });

  it("ignores typical Android GPS jitter", () => {
    const jitter = { ...base, lat: base.lat + 0.0003, lng: base.lng + 0.0003 };
    expect(metersBetweenCoords(base, jitter)).toBeLessThan(80);
    expect(shouldPersistGpsUpdate(base, jitter)).toBe(false);
  });

  it("persists a real move", () => {
    const moved = { ...base, lat: 59.94, lng: 30.31 };
    expect(metersBetweenCoords(base, moved)).toBeGreaterThan(500);
    expect(shouldPersistGpsUpdate(base, moved)).toBe(true);
  });

  it("persists a timezone change even if coords are still", () => {
    expect(shouldPersistGpsUpdate(base, { ...base, timezone: "Europe/Berlin" })).toBe(true);
  });
});
