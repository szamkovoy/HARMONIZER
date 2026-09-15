/**
 * Exact locale copy for marketing emails (same rules as admin push).
 */
import {
  ALL_CONTENT_LOCALES,
  asContentLocale,
  type AppContentLocale,
} from "./contentLocales";
import {
  hasExactLocalizedTitle,
  pickExactLocalizedText,
} from "./contentLocaleFallback";

export type EmailCopySource = {
  subject: string;
  htmlBody?: string | null;
  subjectI18n?: Record<string, string> | null;
  htmlBodyI18n?: Record<string, string> | null;
};

export function resolveEmailLocale(contactLocale: string | null | undefined): AppContentLocale {
  return asContentLocale(contactLocale) ?? "ru";
}

/**
 * Temporary Russian-market stub for one-off campaigns: every contact gets this
 * locale's authored copy, ignoring `users.locale`.
 * Set to `null` when per-locale marketing letters go live.
 * Automations keep exact-match via `resolveExactEmailCopy`.
 */
export const MARKETING_CAMPAIGN_FORCE_COPY_LOCALE: AppContentLocale | null = "ru";

/**
 * Exact authored subject + HTML for contact.locale — no EN/RU fallback.
 * Null = skip recipient (count as skipped_locale).
 */
export function resolveExactEmailCopy(
  contactLocale: string | null | undefined,
  source: EmailCopySource,
): { locale: AppContentLocale; subject: string; htmlBody: string } | null {
  const locale = resolveEmailLocale(contactLocale);
  if (!hasExactLocalizedTitle(locale, source.subject, source.subjectI18n)) {
    return null;
  }
  const subject = pickExactLocalizedText(locale, source.subject, source.subjectI18n);
  const htmlBody = pickExactLocalizedText(locale, source.htmlBody ?? "", source.htmlBodyI18n);
  if (!htmlBody.trim()) return null;
  return { locale, subject, htmlBody };
}

/** Campaign send/count: force-locale stub, else exact match. */
export function resolveCampaignEmailCopy(
  contactLocale: string | null | undefined,
  source: EmailCopySource,
): { locale: AppContentLocale; subject: string; htmlBody: string } | null {
  return resolveExactEmailCopy(
    MARKETING_CAMPAIGN_FORCE_COPY_LOCALE ?? contactLocale,
    source,
  );
}

/** True when no locale has both an authored subject and a non-empty HTML body. */
export function isEmailCopyEmpty(source: EmailCopySource): boolean {
  return ALL_CONTENT_LOCALES.every((locale) => resolveExactEmailCopy(locale, source) == null);
}
