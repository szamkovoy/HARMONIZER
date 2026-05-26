import type { DateTime } from "luxon";

const TEST_MODE_ON = process.env.TEST_MODE_FAST_INTERVALS === "1";

const TIME_DIVISOR = (() => {
  const v = Number.parseInt(process.env.TEST_MODE_TIME_DIVISOR ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : 600;
})();

let startupLogged = false;

export function isTestMode(): boolean {
  return TEST_MODE_ON;
}

/**
 * Returns real milliseconds for a duration in hours. In test mode scales by TIME_DIVISOR.
 * Example: hoursToMs(4) in production = 14_400_000 (4h);
 *          hoursToMs(4) with divisor 600 = 24_000 (24s).
 */
export function hoursToMs(hours: number): number {
  const base = hours * 60 * 60 * 1000;
  return TEST_MODE_ON ? Math.round(base / TIME_DIVISOR) : base;
}

export function minutesToMs(minutes: number): number {
  const base = minutes * 60 * 1000;
  return TEST_MODE_ON ? Math.round(base / TIME_DIVISOR) : base;
}

/** Active in-dialog TTL: always real 2h so pauses between user replies never reset history. */
export function sessionTtlMs(): number {
  return 2 * 60 * 60 * 1000;
}

/**
 * Session resume TTL (GET sync / picking open conversation after app reopen).
 * In test mode uses compressed 2h → seconds so a short real pause simulates «long gap» and starts a fresh dialog.
 */
export function sessionResumeTtlMs(): number {
  return TEST_MODE_ON ? hoursToMs(2) : sessionTtlMs();
}

/** Extended dialog export (debug blocks in message meta + dialog_state_after) — test mode or explicit server flag. */
export function isDebugDialogExportEnabled(): boolean {
  return TEST_MODE_ON || process.env.DEBUG_DIALOG_EXPORT === "1";
}

export function hoursToSec(hours: number): number {
  return Math.round(hoursToMs(hours) / 1000);
}

export function planningReconciliationDelayMs(): number {
  return minutesToMs(10);
}

export function forcedPhaseOrNull(): "morning" | "day" | "evening" | null {
  const v = process.env.TEST_MODE_FORCE_PHASE;
  if (v === "morning" || v === "day" || v === "evening") return v;
  return null;
}

/** Representative local hour sent to the dialog prompt when a phase is forced. */
export function representativeLocalHourForPhase(phase: "morning" | "day" | "evening"): number {
  if (phase === "morning") return 9;
  if (phase === "day") return 14;
  return 19;
}

/** Hour for {{local_hour}} / {{time_of_day}} in dialog prompts; aligns greeting with forced phase. */
export function promptLocalHour(realLocalHour: number): number {
  const forced = forcedPhaseOrNull();
  return forced ? representativeLocalHourForPhase(forced) : realLocalHour;
}

/** Effective local time for dialog interpretation under forced phase in QA. */
export function effectiveDialogNowLocal<T extends DateTime>(realNowLocal: T): T {
  const forced = forcedPhaseOrNull();
  if (!forced) return realNowLocal;
  return realNowLocal.set({
    hour: representativeLocalHourForPhase(forced),
    second: 0,
    millisecond: 0,
  }) as T;
}

export function getTimeDivisor(): number {
  return TIME_DIVISOR;
}

/** One-time stderr warning when the Node server starts with test mode active. */
export function logTestModeStartupWarning(): void {
  if (!TEST_MODE_ON || startupLogged) return;
  startupLogged = true;
  const forced = forcedPhaseOrNull();
  console.warn(
    `[TEST MODE] Time intervals scaled by 1/${TIME_DIVISOR}. Forced phase: ${forced ?? "none"}.`,
  );
}
