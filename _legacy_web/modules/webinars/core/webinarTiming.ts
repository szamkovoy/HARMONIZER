/** Hours after starts_at during which the home announce banner stays visible. */
export const WEBINAR_JOIN_GRACE_HOURS = 1;

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
