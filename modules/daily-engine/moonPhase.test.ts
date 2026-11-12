import { describe, expect, it } from "vitest";

import { eclipticLongitudeForPlanetAt } from "@/modules/astro-core";
import { angularDistance } from "./core/aspects";
import { computeMoonPhaseForLocalDay } from "./moonPhase";

function orbAt(isoTime: string): { new: number; full: number } {
  const date = new Date(isoTime);
  const sun = eclipticLongitudeForPlanetAt("Sun", date);
  const moon = eclipticLongitudeForPlanetAt("Moon", date);
  const dist = angularDistance(sun, moon);
  return { new: Math.abs(dist - 0), full: Math.abs(dist - 180) };
}

function localHour(isoTime: string, timezone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      hour12: false,
    }).format(new Date(isoTime)),
  );
}

describe("computeMoonPhaseForLocalDay", () => {
  it("returns null for a day with no syzygy", () => {
    // 2026-05-22 — середина между новолунием и полнолунием, сизигии нет.
    const event = computeMoonPhaseForLocalDay({
      forecastDate: "2026-05-22",
      timezone: "Europe/Moscow",
    });
    expect(event).toBeNull();
  });

  it("returns an event whose moment is a true syzygy (orb < 0.05°) and within the local day", () => {
    // Сканируем месяц, собираем дни с сизигией.
    const timezone = "Europe/Moscow";
    const syzygyDays: string[] = [];
    for (let day = 1; day <= 31; day += 1) {
      const date = `2026-05-${String(day).padStart(2, "0")}`;
      const event = computeMoonPhaseForLocalDay({ forecastDate: date, timezone });
      if (event) syzygyDays.push(date);
    }
    // За ~29.5-дневный цикл ожидаем ровно две сизигии в мае 2026 (новолуние + полнолуние).
    expect(syzygyDays.length).toBeGreaterThanOrEqual(1);
    expect(syzygyDays.length).toBeLessThanOrEqual(3);

    for (const date of syzygyDays) {
      const event = computeMoonPhaseForLocalDay({ forecastDate: date, timezone })!;
      const orb = orbAt(event.time)[event.kind];
      expect(orb).toBeLessThan(0.05);

      // Момент должен попадать в локальные сутки этой даты.
      const asUtcDay = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(event.time));
      expect(asUtcDay).toBe(date);

      // Час должен быть валидным.
      const hour = localHour(event.time, timezone);
      expect(hour).toBeGreaterThanOrEqual(0);
      expect(hour).toBeLessThanOrEqual(23);
    }
  });

  it("treats the syzygy as global — same moment, different timezone may shift the calendar day", () => {
    // Новолуние 2026-05-16 ~20:02 UTC. В Москве (UTC+3) — 23:02 16 мая,
    // в Окленде (UTC+12) — 08:02 17 мая. Сизигия глобальна, но день, в который
    // она попадает, определяется timezone пользователя.
    const moscow = computeMoonPhaseForLocalDay({
      forecastDate: "2026-05-16",
      timezone: "Europe/Moscow",
    });
    expect(moscow).not.toBeNull();
    expect(moscow?.kind).toBe("new");

    const aucklandOn16 = computeMoonPhaseForLocalDay({
      forecastDate: "2026-05-16",
      timezone: "Pacific/Auckland",
    });
    const aucklandOn17 = computeMoonPhaseForLocalDay({
      forecastDate: "2026-05-17",
      timezone: "Pacific/Auckland",
    });
    // В Окленде сизигия ушла на 17 мая: 16-е — пусто, 17-е — новолуние.
    expect(aucklandOn16).toBeNull();
    expect(aucklandOn17).not.toBeNull();
    expect(aucklandOn17?.kind).toBe("new");
  });
});
