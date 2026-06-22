import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { practiceByChakraWindow } from "./route";

describe("practiceByChakraWindow", () => {
  it("uses full local calendar days instead of a sliding 24-hour window", () => {
    const morning = practiceByChakraWindow(
      7,
      "Europe/Paris",
      DateTime.fromISO("2026-06-21T06:00:00Z", { zone: "utc" }),
    );
    const evening = practiceByChakraWindow(
      7,
      "Europe/Paris",
      DateTime.fromISO("2026-06-21T18:00:00Z", { zone: "utc" }),
    );

    expect(morning).toEqual(evening);
    expect(morning.fromLocalDate).toBe("2026-06-15");
    expect(morning.throughLocalDate).toBe("2026-06-21");
    expect(DateTime.fromISO(morning.startUtc, { zone: "utc" }).setZone("Europe/Paris").toFormat("yyyy-MM-dd HH:mm"))
      .toBe("2026-06-15 00:00");
    expect(DateTime.fromISO(morning.endUtcExclusive, { zone: "utc" }).setZone("Europe/Paris").toFormat("yyyy-MM-dd HH:mm"))
      .toBe("2026-06-22 00:00");
  });
});
