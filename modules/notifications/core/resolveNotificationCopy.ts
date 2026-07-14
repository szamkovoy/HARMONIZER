/**
 * Single source of truth for notification copy language.
 *
 * Remote pushes (admin, future webinar reminders) MUST use this helper with
 * `users.locale`. Local opportunity reminders use the same locale resolution
 * via getAppLocale() + typed strings (template content, not admin i18n maps).
 */
import {
  asContentLocale,
  pickLocalizedText,
  type AppContentLocale,
} from "@/modules/i18n";

export type NotificationCopySource = {
  title: string;
  body?: string | null;
  titleI18n?: Record<string, string> | null;
  bodyI18n?: Record<string, string> | null;
};

/** Profile / users.locale → content locale (default ru). */
export function resolveNotificationLocale(userLocale: string | null | undefined): AppContentLocale {
  return asContentLocale(userLocale) ?? "ru";
}

/**
 * Title/body for one recipient: preferred → en → ru (soft fallback).
 * Used by Expo push personalization and inbox display.
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
