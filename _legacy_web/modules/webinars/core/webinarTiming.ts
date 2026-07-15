import { DateTime } from "luxon";

/** Hours after starts_at during which the home announce banner stays visible. */
export const WEBINAR_JOIN_GRACE_HOURS = 1;

/**
 * Compact local datetime for home banner: `15 июля, 10:00` / `15 авг, 10:00`.
 * Short month names stay full; longer ones use the locale short form.
 */
export function formatWebinarBannerWhen(startsAtIso: string, locale: string): string {
  const dt = DateTime.fromISO(startsAtIso).setLocale(locale);
  const longMonth = dt.toFormat("MMMM").replace(/\.$/, "");
  const month =
    longMonth.length <= 5 ? longMonth : dt.toFormat("MMM").replace(/\.$/, "");
  return `${dt.toFormat("d")} ${month}, ${dt.toFormat("HH:mm")}`;
}

export function webinarJoinWindowEndsAt(startsAtIso: string): Date {
  return new Date(new Date(startsAtIso).getTime() + WEBINAR_JOIN_GRACE_HOURS * 60 * 60 * 1000);
}

/** True while users may still join / see the home banner (before starts_at + grace). */
export function isWebinarInJoinWindow(startsAtIso: string, nowMs: number = Date.now()): boolean {
  return webinarJoinWindowEndsAt(startsAtIso).getTime() > nowMs;
}

/** Recording admin tab appears after the join window ends. */
export function isWebinarRecordingTabAvailable(startsAtIso: string, nowMs: number = Date.now()): boolean {
  return !isWebinarInJoinWindow(startsAtIso, nowMs);
}
