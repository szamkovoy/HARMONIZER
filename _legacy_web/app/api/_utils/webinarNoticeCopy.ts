/**
 * Invitation and recording letters. One locale for the whole letter:
 * subject, greeting, body and sign-off. The body itself is the admin text.
 */
import { asWidgetLocale, type WidgetLocale } from "../../../lib/paymentWidget/copy";

export type WebinarNoticeKind = "invite" | "recording";

export type WebinarNoticeCopy = {
  inviteSubject: string;
  recordingSubject: string;
  greeting: (name: string) => string;
  greetingNoName: string;
  closing: string;
  /** Author's signature. Russian keeps the Cyrillic name; other locales use the Latin form already used in the From line. */
  signature: string;
  joinButton: string;
  /** Fixed room code, on the line directly under the join button. Same code in every locale; only the label is translated. */
  accessCode: string;
};

const COPY: Record<WidgetLocale, WebinarNoticeCopy> = {
  ru: {
    inviteSubject: "Приглашаю на вебинар",
    recordingSubject: "Запись вебинара",
    greeting: (n) => `Здравствуйте, ${n}!`,
    greetingNoName: "Здравствуйте!",
    closing: "До встречи!",
    signature: "Сергей Замковой",
    joinButton: "Перейти в вебинарную комнату",
    accessCode: "Код доступа: 123456",
  },
  en: {
    inviteSubject: "I invite you to a webinar",
    recordingSubject: "The webinar recording",
    greeting: (n) => `Hello, ${n}!`,
    greetingNoName: "Hello!",
    closing: "See you soon!",
    signature: "Sergei Zamkovoi",
    joinButton: "Go to the webinar room",
    accessCode: "Access code: 123456",
  },
  de: {
    inviteSubject: "Ich lade Sie zum Webinar ein",
    recordingSubject: "Die Aufzeichnung des Webinars",
    greeting: (n) => `Guten Tag, ${n}!`,
    greetingNoName: "Guten Tag!",
    closing: "Bis bald!",
    signature: "Sergei Zamkovoi",
    joinButton: "Zum Webinar-Raum",
    accessCode: "Zugangscode: 123456",
  },
  fr: {
    inviteSubject: "Je vous invite au webinaire",
    recordingSubject: "L'enregistrement du webinaire",
    greeting: (n) => `Bonjour ${n} !`,
    greetingNoName: "Bonjour !",
    closing: "À bientôt !",
    signature: "Sergei Zamkovoi",
    joinButton: "Accéder à la salle du webinaire",
    accessCode: "Code d'accès : 123456",
  },
  it: {
    inviteSubject: "Ti invito al webinar",
    recordingSubject: "La registrazione del webinar",
    greeting: (n) => `Buongiorno ${n}!`,
    greetingNoName: "Buongiorno!",
    closing: "A presto!",
    signature: "Sergei Zamkovoi",
    joinButton: "Vai alla stanza del webinar",
    accessCode: "Codice di accesso: 123456",
  },
  es: {
    inviteSubject: "Te invito al webinar",
    recordingSubject: "La grabación del webinar",
    greeting: (n) => `¡Hola, ${n}!`,
    greetingNoName: "¡Hola!",
    closing: "¡Hasta pronto!",
    signature: "Sergei Zamkovoi",
    joinButton: "Ir a la sala del webinar",
    accessCode: "Código de acceso: 123456",
  },
  pt: {
    inviteSubject: "Convido-o para o webinar",
    recordingSubject: "A gravação do webinar",
    greeting: (n) => `Olá, ${n}!`,
    greetingNoName: "Olá!",
    closing: "Até breve!",
    signature: "Sergei Zamkovoi",
    joinButton: "Ir para a sala do webinar",
    accessCode: "Código de acesso: 123456",
  },
  nl: {
    inviteSubject: "Ik nodig je uit voor het webinar",
    recordingSubject: "De opname van het webinar",
    greeting: (n) => `Hallo ${n}!`,
    greetingNoName: "Hallo!",
    closing: "Tot snel!",
    signature: "Sergei Zamkovoi",
    joinButton: "Naar de webinarruimte",
    accessCode: "Toegangscode: 123456",
  },
};

/** Default Russian letter on the webinar «Запись» tab. The author inserts the link. */
export const RECORDING_LETTER_SUBJECT = "Запись вебинара";

export const RECORDING_LETTER_BODY = `Здравствуйте, {{name}}!

Запись вебинара готова, и вы можете посмотреть её, перейдя по ссылке - 

Срок хранения записи - одна неделя.

Всех благ!
Сергей Замковой`;

export function getWebinarNoticeCopy(locale: string | null | undefined): WebinarNoticeCopy {
  return COPY[asWidgetLocale(locale) ?? "ru"];
}

/**
 * Language of the whole letter. A translation is used only when that locale
 * has its own text; otherwise the letter is entirely Russian.
 */
export function letterLocale(
  recipientLocale: string | null | undefined,
  ruText: string | null | undefined,
  i18n: unknown,
): { locale: WidgetLocale; text: string } | null {
  const ru = (ruText ?? "").trim();
  const requested = asWidgetLocale(recipientLocale) ?? "ru";
  if (requested !== "ru") {
    const translated = ownI18nText(i18n, requested);
    if (translated) return { locale: requested, text: translated };
  }
  if (!ru) return null;
  return { locale: "ru", text: ru };
}

/** Product letter: both subject and body must exist in the same locale. */
export function purchaseLetterLocale(
  recipientLocale: string | null | undefined,
  subjectMap: unknown,
  bodyMap: unknown,
): WidgetLocale | null {
  const requested = asWidgetLocale(recipientLocale) ?? "ru";
  if (requested !== "ru" && ownI18nText(subjectMap, requested) && ownI18nText(bodyMap, requested)) {
    return requested;
  }
  if (ownI18nText(subjectMap, "ru") && ownI18nText(bodyMap, "ru")) return "ru";
  return null;
}

/** {{name}} → the person's name. An empty name drops the comma. Blank lines stay. */
export function fillLetterName(text: string, name: string | null | undefined): string {
  const safe = (name ?? "").trim();
  const out = text.replace(/\{\{\s*(?:display_)?name\s*\}\}/gi, safe);
  return safe ? out : out.replace(/,\s*!/g, "!");
}

/**
 * Subject and body of the recording letter in one language.
 * `ru` columns win over a `ru` key inside the i18n maps.
 */
export function authoredRecordingLetter(
  recipientLocale: string | null | undefined,
  subjectRu: string,
  subjectI18n: unknown,
  bodyRu: string,
  bodyI18n: unknown,
): { locale: WidgetLocale; subject: string; body: string } | null {
  const subjects = { ...asTextMap(subjectI18n), ru: subjectRu.trim() };
  const bodies = { ...asTextMap(bodyI18n), ru: bodyRu.trim() };
  const locale = purchaseLetterLocale(recipientLocale, subjects, bodies);
  if (!locale) return null;
  return {
    locale,
    subject: ownI18nText(subjects, locale),
    body: ownI18nText(bodies, locale),
  };
}

function asTextMap(map: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!map || typeof map !== "object") return out;
  for (const [key, value] of Object.entries(map as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) out[key] = value.trim();
  }
  return out;
}

export function ownI18nText(map: unknown, locale: string): string {
  if (!map || typeof map !== "object") return "";
  const value = (map as Record<string, unknown>)[locale];
  return typeof value === "string" ? value.trim() : "";
}

export function buildNoticePlainText(params: {
  kind: WebinarNoticeKind;
  locale: WidgetLocale;
  name: string;
  body: string;
  joinUrl?: string | null;
}): { subject: string; text: string } {
  const copy = getWebinarNoticeCopy(params.locale);
  const greeting = params.name.trim() ? copy.greeting(params.name.trim()) : copy.greetingNoName;
  const lines = [greeting, "", params.body.trim()];
  if (params.kind === "invite" && params.joinUrl?.trim()) {
    lines.push("", copy.joinButton, params.joinUrl.trim(), copy.accessCode);
  }
  lines.push("", copy.closing, copy.signature);
  return {
    subject: params.kind === "invite" ? copy.inviteSubject : copy.recordingSubject,
    text: lines.join("\n"),
  };
}
