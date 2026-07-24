/**
 * Server mirror of modules/notifications/core/resolveNotificationCopy.ts.
 * Keep in sync — admin Expo push and any future server-side reminders.
 */
import { asContentLocale, type AppContentLocale } from "./contentLocales";
import {
  hasExactLocalizedTitle,
  pickExactLocalizedText,
  pickLocalizedText,
} from "./contentLocaleFallback";

export type NotificationCopySource = {
  title: string;
  body?: string | null;
  titleI18n?: Record<string, string> | null;
  bodyI18n?: Record<string, string> | null;
};

export function resolveNotificationLocale(userLocale: string | null | undefined): AppContentLocale {
  return asContentLocale(userLocale) ?? "ru";
}

/**
 * Soft resolve (preferred → en → ru) for inbox display of already-delivered rows.
 */
export function resolveNotificationCopy(
  userLocale: string | null | undefined,
  source: NotificationCopySource,
): { locale: AppContentLocale; title: string; body: string } {
  const locale = resolveNotificationLocale(userLocale);
  const title =
    pickLocalizedText(locale, source.title, source.titleI18n) || source.title.trim() || "";
  const body = pickLocalizedText(locale, source.body ?? "", source.bodyI18n);
  return { locale, title, body };
}

/**
 * Exact authored copy for `users.locale` only — no EN/RU fallback.
 * Used when building admin remote push + deliveries. Null = skip recipient.
 */
export function resolveExactNotificationCopy(
  userLocale: string | null | undefined,
  source: NotificationCopySource,
): { locale: AppContentLocale; title: string; body: string } | null {
  const locale = resolveNotificationLocale(userLocale);
  if (!hasExactLocalizedTitle(locale, source.title, source.titleI18n)) {
    return null;
  }
  const title = pickExactLocalizedText(locale, source.title, source.titleI18n);
  const body = pickExactLocalizedText(locale, source.body ?? "", source.bodyI18n);
  return { locale, title, body };
}

/** APNs / FCM practical limit — keep alert readable; full text stays in inbox. */
export function truncatePushBody(body: string, maxChars = 350): string {
  const normalized = body.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}
