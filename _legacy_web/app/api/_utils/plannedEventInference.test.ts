import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { inferPlannedEventsFromUserHistory } from "./plannedEventInference";

const TZ = "Europe/Moscow";

describe("inferPlannedEventsFromUserHistory", () => {
  it("extracts a timed event from a user message with relative time", () => {
    const nowLocal = DateTime.fromISO("2026-05-25T09:00:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [
        {
          role: "user",
          content:
            "Добрый день! Прекрасный день! Через полчаса у меня начнется вебинар, поэтому я готов выполнить короткую практику дыхания 10-15 минут буквально.",
        },
      ],
      nowLocal,
      tz: TZ,
      locale: "ru",
    });

    expect(inferred).toHaveLength(1);
    expect(inferred[0]?.time).toBe("через полчаса");
    expect(inferred[0]?.desc.toLowerCase()).toContain("вебинар");
  });

  it("ignores short duration-only replies", () => {
    const nowLocal = DateTime.fromISO("2026-05-25T09:00:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [{ role: "user", content: "15 минут" }],
      nowLocal,
      tz: TZ,
      locale: "ru",
    });

    expect(inferred).toHaveLength(0);
  });

  it("extracts explicit clock time from a planning clause", () => {
    const nowLocal = DateTime.fromISO("2026-05-25T09:00:00", { zone: TZ });
    const inferred = inferPlannedEventsFromUserHistory({
      history: [{ role: "user", content: "Сегодня в 18:00 у меня созвон с командой." }],
      nowLocal,
      tz: TZ,
      locale: "ru",
    });

    expect(inferred).toHaveLength(1);
    expect(inferred[0]?.time).toMatch(/18:00/);
    expect(inferred[0]?.desc.toLowerCase()).toContain("созвон");
  });
});
