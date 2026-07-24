// @ts-nocheck
/** Server copy for webinar-start push — keep in sync with modules/i18n/catalog `notifications.webinarStart.*`. */

export type ContentLocale = "ru" | "en" | "de" | "fr" | "it" | "es" | "pt" | "nl";

const COPY: Record<ContentLocale, { title: string; body: (webinarTitle: string) => string }> = {
  ru: {
    title: "Вебинар начинается",
    body: (t) => `«${t}» — присоединяйтесь по ссылке.`,
  },
  en: {
    title: "The webinar is starting",
    body: (t) => `“${t}” — join via the link.`,
  },
  de: {
    title: "Das Webinar beginnt",
    body: (t) => `„${t}“ — treten Sie über den Link bei.`,
  },
  fr: {
    title: "Le webinaire commence",
    body: (t) => `« ${t} » — rejoignez-nous via le lien.`,
  },
  it: {
    title: "Il webinar sta iniziando",
    body: (t) => `«${t}» — unisciti tramite il link.`,
  },
  es: {
    title: "El webinar está empezando",
    body: (t) => `«${t}» — únete a través del enlace.`,
  },
  pt: {
    title: "O webinar está a começar",
    body: (t) => `«${t}» — participe através do link.`,
  },
  nl: {
    title: "Het webinar begint",
    body: (t) => `‘${t}’ — doe mee via de link.`,
  },
};

export function asContentLocale(value: string | null | undefined): ContentLocale {
  const code = (value ?? "").trim().slice(0, 2).toLowerCase();
  if (code in COPY) return code as ContentLocale;
  return "ru";
}

export function webinarStartCopy(locale: string | null | undefined, webinarTitle: string): {
  locale: ContentLocale;
  title: string;
  body: string;
} {
  const loc = asContentLocale(locale);
  const titleText = webinarTitle.trim() || "Webinar";
  return {
    locale: loc,
    title: COPY[loc].title,
    body: COPY[loc].body(titleText),
  };
}

export function pickExactWebinarTitle(
  locale: string | null | undefined,
  ruTitle: string,
  titleI18n: Record<string, string> | null | undefined,
): string {
  const loc = asContentLocale(locale);
  if (loc === "ru") return (ruTitle ?? "").trim();
  const mapped = titleI18n?.[loc];
  if (typeof mapped === "string" && mapped.trim()) return mapped.trim();
  // Name fallback only (template strings stay on user locale).
  const en = titleI18n?.en;
  if (typeof en === "string" && en.trim()) return en.trim();
  return (ruTitle ?? "").trim() || "Webinar";
}
