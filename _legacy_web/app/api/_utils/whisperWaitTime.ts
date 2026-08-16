/**
 * Parse Groq/OpenAI-style rate-limit wait hints into milliseconds.
 * Priority: retry-after → x-ratelimit-reset-* → error.message → null (caller uses ladder).
 */
export const WAIT_MS_MIN = 1_000;
export const WAIT_MS_MAX = 24 * 60 * 60 * 1_000;

export const LADDER_MS = [
  2 * 60 * 1_000, // 2 min — RPM burst
  70 * 60 * 1_000, // 1h10 — hourly audio budget
  23 * 60 * 60 * 1_000, // 23h — daily budget
] as const;

/** "7.66s" | "2m59.56s" | "1h15m30s" | "6m 11.52s" | "12.4" (bare seconds) */
export function parseDurationToMs(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;

  if (/^\d+(\.\d+)?$/.test(text)) {
    const sec = Number(text);
    return Number.isFinite(sec) && sec > 0 ? Math.round(sec * 1000) : null;
  }

  let totalMs = 0;
  let matched = false;
  // Longer unit names first; no trailing \b so "2m59.56s" (no space) still parses.
  const re =
    /(\d+(?:\.\d+)?)\s*(milliseconds?|ms|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)/gi;
  for (const m of text.matchAll(re)) {
    matched = true;
    const n = Number(m[1]);
    if (!Number.isFinite(n)) continue;
    const unit = m[2]!.toLowerCase();
    if (unit === "ms" || unit.startsWith("millisecond")) {
      totalMs += n;
    } else if (unit.startsWith("h")) {
      totalMs += n * 3_600_000;
    } else if (unit.startsWith("m")) {
      totalMs += n * 60_000;
    } else {
      totalMs += n * 1_000;
    }
  }
  if (!matched || totalMs <= 0) return null;
  return Math.round(totalMs);
}

export function clampWaitMs(ms: number): number | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  if (ms < WAIT_MS_MIN) return WAIT_MS_MIN;
  if (ms > WAIT_MS_MAX) return null; // treat absurd values as invalid → ladder
  return Math.round(ms);
}

export function ladderDelayMs(consecutiveFallbackCount: number): number {
  const idx = Math.min(Math.max(consecutiveFallbackCount, 1), LADDER_MS.length) - 1;
  return LADDER_MS[idx]!;
}

export function extractWaitTimeMs(input: {
  headers?: Headers | Record<string, string> | null;
  bodyText?: string | null;
}): number | null {
  const headerGet = (name: string): string | null => {
    if (!input.headers) return null;
    if (typeof (input.headers as Headers).get === "function") {
      return (input.headers as Headers).get(name);
    }
    const rec = input.headers as Record<string, string>;
    const hit = Object.entries(rec).find(([k]) => k.toLowerCase() === name.toLowerCase());
    return hit?.[1] ?? null;
  };

  const retryAfter = headerGet("retry-after");
  if (retryAfter) {
    const clamped = clampWaitMs(parseDurationToMs(retryAfter) ?? Number.NaN);
    if (clamped != null) return clamped;
  }

  for (const name of [
    "x-ratelimit-reset-requests",
    "x-ratelimit-reset-tokens",
    "x-ratelimit-reset",
  ]) {
    const raw = headerGet(name);
    if (!raw) continue;
    const clamped = clampWaitMs(parseDurationToMs(raw) ?? Number.NaN);
    if (clamped != null) return clamped;
  }

  const body = input.bodyText ?? "";
  let message = body;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string };
    message = parsed.error?.message ?? parsed.message ?? body;
  } catch {
    /* plain text */
  }

  const again = message.match(/try again in\s+([0-9hminssec.\s]+)/i);
  if (again?.[1]) {
    const clamped = clampWaitMs(parseDurationToMs(again[1]) ?? Number.NaN);
    if (clamped != null) return clamped;
  }

  return null;
}

export function isGroqFailoverStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
