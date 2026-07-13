import type { AppLocale } from "@/modules/i18n";

/** Letters only — Hermes-safe (no Unicode property escapes). */
const LETTER_RE = /[^A-Za-zА-Яа-яЁё]/g;
const CYRILLIC_RE = /[А-Яа-яЁё]/g;

/**
 * Non-RU locales must not persist Cyrillic LLM slips (models sometimes ignore
 * OUTPUT LANGUAGE and return Russian into an `en`/`de`/… cache key).
 *
 * Uses explicit Cyrillic ranges — `\p{Script=Cyrillic}` is unreliable in Hermes
 * and would treat Russian copy as valid English.
 */
export function textLooksLikeRussian(text: string): boolean {
  const letters = text.replace(LETTER_RE, "");
  if (letters.length < 12) return false;
  const cyrillic = (letters.match(CYRILLIC_RE) ?? []).length;
  return cyrillic / letters.length >= 0.45;
}

export function assertDayTextsMatchLocale(
  locale: AppLocale,
  slogan: string,
  shortText: string,
): void {
  if (locale === "ru") return;
  if (textLooksLikeRussian(slogan) || textLooksLikeRussian(shortText)) {
    throw new Error(`Day content language mismatch for locale=${locale}`);
  }
}

export function dayTextsMatchLocale(locale: AppLocale, slogan: string, shortText: string): boolean {
  if (locale === "ru") return true;
  return !textLooksLikeRussian(slogan) && !textLooksLikeRussian(shortText);
}
