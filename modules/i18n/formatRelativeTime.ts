import type { AppLocale } from "@/modules/i18n/localeStore";
import { t } from "@/modules/i18n/t";

type RelativeUnit = "seconds" | "minutes" | "hours" | "days" | "weeks" | "months" | "years";

/**
 * Locale-aware relative timestamps for Hermes (no Intl.RelativeTimeFormat).
 * Uses abbreviated unit labels (`15 мин`, `2 h`) — one largest unit only,
 * so plural/declension rules are not needed.
 */
export function formatRelativeTime(
  value: string | Date,
  locale: AppLocale,
  now: Date = new Date(),
): string {
  const then = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(then.getTime())) return "";

  const diffMs = then.getTime() - now.getTime();
  const absSec = Math.round(Math.abs(diffMs) / 1000);
  if (absSec < 5) return t(locale, "time.relative.justNow");

  const { unit, count } = pickRelativeUnit(absSec);
  const key = diffMs <= 0 ? `time.relative.${unit}Past` : `time.relative.${unit}Future`;
  return t(locale, key, { count });
}

/** Pick a single dominant unit (minutes hide seconds; hours hide minutes; …). */
function pickRelativeUnit(absSec: number): { unit: RelativeUnit; count: number } {
  if (absSec < 45) return { unit: "seconds", count: Math.max(1, absSec) };
  const minutes = Math.round(absSec / 60);
  if (minutes < 45) return { unit: "minutes", count: Math.max(1, minutes) };
  const hours = Math.round(minutes / 60);
  if (hours < 22) return { unit: "hours", count: Math.max(1, hours) };
  const days = Math.round(hours / 24);
  if (days < 7) return { unit: "days", count: Math.max(1, days) };
  const weeks = Math.round(days / 7);
  if (weeks < 5) return { unit: "weeks", count: Math.max(1, weeks) };
  const months = Math.round(days / 30);
  if (months < 12) return { unit: "months", count: Math.max(1, months) };
  const years = Math.max(1, Math.round(days / 365));
  return { unit: "years", count: years };
}
