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

export function hoursToSec(hours: number): number {
  return Math.round(hoursToMs(hours) / 1000);
}

export function forcedPhaseOrNull(): "morning" | "day" | "evening" | null {
  const v = process.env.TEST_MODE_FORCE_PHASE;
  if (v === "morning" || v === "day" || v === "evening") return v;
  return null;
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
