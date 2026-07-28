/** Format seconds as YouTube-style duration: `4:23` or `1:04:23`. */
export function formatVideoDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** Split total seconds into HH / MM / SS digit strings (empty when zero & others empty). */
export function splitDurationParts(totalSeconds: number | null | undefined): {
  hours: string;
  minutes: string;
  seconds: string;
} {
  if (totalSeconds == null || !Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return { hours: "", minutes: "", seconds: "" };
  }
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return {
    hours: h > 0 ? String(h).padStart(2, "0") : "",
    minutes: String(m).padStart(2, "0"),
    seconds: String(sec).padStart(2, "0"),
  };
}

/**
 * Parse HH/MM/SS digit fields → total seconds.
 * Empty hours → 0. All empty → null. Invalid → null.
 */
export function parseDurationParts(
  hours: string,
  minutes: string,
  seconds: string,
): number | null {
  const hRaw = hours.trim();
  const mRaw = minutes.trim();
  const sRaw = seconds.trim();
  if (!hRaw && !mRaw && !sRaw) return null;

  const h = hRaw === "" ? 0 : Number(hRaw);
  const m = mRaw === "" ? 0 : Number(mRaw);
  const sec = sRaw === "" ? 0 : Number(sRaw);
  if (![h, m, sec].every((n) => Number.isFinite(n) && n >= 0)) return null;
  if (m > 59 || sec > 59) return null;
  if (h > 99) return null;
  const total = Math.floor(h) * 3600 + Math.floor(m) * 60 + Math.floor(sec);
  return total > 0 ? total : null;
}

/** Keep only digits, max 2 chars. */
export function sanitizeDurationDigits(value: string): string {
  return value.replace(/\D/g, "").slice(0, 2);
}
