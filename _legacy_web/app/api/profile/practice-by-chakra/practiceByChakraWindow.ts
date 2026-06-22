import { DateTime } from "luxon";

export function practiceByChakraWindow(days: number, timezone: string, now = DateTime.utc()) {
  const zone = timezone?.trim() || "UTC";
  const zonedNow = now.setZone(zone);
  const endLocalExclusive = zonedNow.startOf("day").plus({ days: 1 });
  const startLocalInclusive = endLocalExclusive.minus({ days }).startOf("day");
  return {
    fromLocalDate: startLocalInclusive.toFormat("yyyy-MM-dd"),
    throughLocalDate: endLocalExclusive.minus({ days: 1 }).toFormat("yyyy-MM-dd"),
    startUtc: startLocalInclusive.toUTC().toISO() ?? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
    endUtcExclusive: endLocalExclusive.toUTC().toISO() ?? new Date().toISOString(),
  };
}
