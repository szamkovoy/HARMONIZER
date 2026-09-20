/** Default first-broadcast warmup: 500, 500, 1000, 1000, 2000, 2000, then 3000/day. */
export const DEFAULT_WARMUP_SIZES = [500, 500, 1000, 1000, 2000, 2000, 3000];
export const DEFAULT_WARMUP_HOUR_MSK = 16;

export type WarmupPlan = {
  sizes: number[];
  repeat_last: boolean;
  hour_msk: number;
  /** `sent_count` when the current wave started. Incomplete waves must not increment index. */
  wave_base_sent?: number;
};

export const TERMINAL_SEND_STATUSES = [
  "sent",
  "delivered",
  "opened",
  "clicked",
  "bounced",
  "complained",
  "skipped",
] as const;

/** Resend accepted or inbox events — never send this campaign again. */
export const SUCCESS_OR_ACCEPTED_STATUSES = [
  "sent",
  "delivered",
  "opened",
  "clicked",
] as const;

export function parseWarmupPlan(raw: unknown): WarmupPlan {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const sizes = Array.isArray(o.sizes)
    ? o.sizes
        .map((n) => Math.floor(Number(n)))
        .filter((n) => Number.isFinite(n) && n > 0)
    : [];
  const hour = Math.floor(Number(o.hour_msk));
  const base = Math.floor(Number(o.wave_base_sent));
  return {
    sizes: sizes.length ? sizes : [...DEFAULT_WARMUP_SIZES],
    repeat_last: o.repeat_last !== false,
    hour_msk:
      Number.isFinite(hour) && hour >= 0 && hour <= 23
        ? hour
        : DEFAULT_WARMUP_HOUR_MSK,
    wave_base_sent: Number.isFinite(base) && base >= 0 ? base : undefined,
  };
}

export function serializeWarmupPlan(plan: WarmupPlan): Record<string, unknown> {
  return {
    sizes: plan.sizes,
    repeat_last: plan.repeat_last,
    hour_msk: plan.hour_msk,
    ...(plan.wave_base_sent != null ? { wave_base_sent: plan.wave_base_sent } : {}),
  };
}

/** How many more contacts this wave still needs queued or accepted. */
export function currentWaveNeed(opts: {
  sentCount: number;
  queuedCount: number;
  nextWaveSize: number | null;
  waveIndex: number;
  plan: WarmupPlan;
}): { quota: number; acceptedThisWave: number; need: number } {
  const quota =
    opts.nextWaveSize && opts.nextWaveSize > 0
      ? opts.nextWaveSize
      : waveSizeAt(opts.waveIndex, opts.plan);
  const base = opts.plan.wave_base_sent ?? 0;
  const acceptedThisWave = Math.max(0, opts.sentCount - base);
  const need = Math.max(0, quota - acceptedThisWave - opts.queuedCount);
  return { quota, acceptedThisWave, need };
}

export function waveSizeAt(index: number, plan: WarmupPlan): number {
  const sizes = plan.sizes.length ? plan.sizes : DEFAULT_WARMUP_SIZES;
  if (index < sizes.length) return sizes[index]!;
  if (plan.repeat_last) return sizes[sizes.length - 1]!;
  return sizes[sizes.length - 1]!;
}

/**
 * Next clock time at `hour_msk` in Europe/Moscow (UTC+3, no DST).
 * Skips the upcoming slot if it is less than 12 hours away (avoid a 10-minute
 * follow-up wave when a batch finishes just before 16:00).
 */
export function nextMskHour(now: Date, hourMsk: number, minGapHours = 12): Date {
  const utcHour = ((hourMsk - 3) % 24 + 24) % 24;
  const next = new Date(now.getTime());
  next.setUTCHours(utcHour, 0, 0, 0);
  const minMs = minGapHours * 60 * 60 * 1000;
  while (next.getTime() - now.getTime() < minMs) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

export function activityMs(
  lastSeenAt: string | null | undefined,
  getcourseAt: string | null | undefined,
): number {
  const a = lastSeenAt ? Date.parse(lastSeenAt) : NaN;
  const b = getcourseAt ? Date.parse(getcourseAt) : NaN;
  const vals = [a, b].filter((n) => Number.isFinite(n));
  return vals.length ? Math.max(...vals) : 0;
}

export function parseAudienceCap(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : null;
}
