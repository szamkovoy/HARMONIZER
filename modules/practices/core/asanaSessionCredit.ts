/**
 * When an asana counts as completed / how long to credit.
 *
 * Phone player progress comes from Vimeo WebView postMessage; that bridge can
 * miss `time`/`ended` (Android page, fullscreen, API attach race). Wall-clock
 * from first play (or screen open) fills the gap so a finished ~20 min video
 * is still credited.
 */
export const ASANA_COMPLETION_TAIL_SEC = 10;

/** Prefer the longer of catalog vs player-reported duration (both may be 0). */
export function asanaTargetDurationSec(catalogDurationSec: number, playerDurationSec: number): number {
  return Math.max(0, Math.floor(catalogDurationSec) || 0, Math.floor(playerDurationSec) || 0);
}

export function asanaWatchedSec(playerElapsedSec: number, wallElapsedSec: number): number {
  return Math.max(0, Math.floor(playerElapsedSec) || 0, Math.floor(wallElapsedSec) || 0);
}

export function isAsanaCompleted(input: {
  practiceEnded: boolean;
  watchedSec: number;
  targetDurationSec: number;
}): boolean {
  if (input.practiceEnded) return true;
  const target = Math.max(0, input.targetDurationSec);
  if (target <= 0) return false;
  return input.watchedSec >= Math.max(0, target - ASANA_COMPLETION_TAIL_SEC);
}

/** Seconds to store on a completed session (never longer than target when known). */
export function asanaCreditedDurationSec(input: {
  watchedSec: number;
  targetDurationSec: number;
}): number {
  const watched = Math.max(1, Math.floor(input.watchedSec) || 1);
  const target = Math.max(0, Math.floor(input.targetDurationSec) || 0);
  if (target > 0) return Math.min(watched, target);
  return watched;
}
