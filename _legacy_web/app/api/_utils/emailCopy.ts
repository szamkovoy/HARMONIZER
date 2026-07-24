/**
 * Exact locale copy for marketing emails (same rules as admin push).
 */
import { asContentLocale, type AppContentLocale } from "./contentLocales";
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
