/**
 * Single source of truth for notification copy language.
 *
 * Remote pushes (admin) use **exact** locale match on the server
 * (`resolveExactNotificationCopy`). Inbox may still soft-resolve for older rows.
 * Local opportunity reminders use getAppLocale() + typed strings.
 */
import {
  asContentLocale,
  hasExactLocalizedTitle,
  pickExactLocalizedText,
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
 * Soft title/body (preferred → en → ru) for inbox display.
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
 * Exact authored copy for locale only. Mirror of server helper for tests/docs.
 */
export function resolveExactNotificationCopy(
  userLocale: string | null | undefined,
  source: NotificationCopySource,
): { locale: AppContentLocale; title: string; body: string } | null {
  const locale = resolveNotificationLocale(userLocale);
  if (!hasExactLocalizedTitle(locale, source.title, source.titleI18n)) {
    return null;
  }
  return {
    locale,
    title: pickExactLocalizedText(locale, source.title, source.titleI18n),
    body: pickExactLocalizedText(locale, source.body ?? "", source.bodyI18n),
  };
}
