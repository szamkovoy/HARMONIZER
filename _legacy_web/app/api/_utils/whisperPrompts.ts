const LANGUAGE_ALIASES: Record<string, string> = {
  ru: "ru",
  russian: "ru",
  en: "en",
  english: "en",
  de: "de",
  german: "de",
  fr: "fr",
  french: "fr",
  it: "it",
  italian: "it",
  es: "es",
  spanish: "es",
  pt: "pt",
  portuguese: "pt",
  nl: "nl",
  dutch: "nl",
};

export const WHISPER_DOMAIN_PROMPTS: Record<string, string> = {
  ru: "Контекст: разговор о йоге, психологии, чакрах и духовных практиках. Используются термины: Муладхара, Свадхистхана, Манипура, Анахата, Вишуддха, Аджна, Сахасрара. Также: натальная карта, Сатурн, Юпитер, Марс, Венера, Меркурий, транзит, аспект, дисгармония, гармония, асана, пранаяма, медитация, чакра, планета дня, окно возможностей.",
  en: "Context: a conversation about yoga, psychology, chakras and spiritual practices. Terms used include: Muladhara, Svadhishthana, Manipura, Anahata, Vishuddha, Ajna, Sahasrara, natal chart, Saturn, Jupiter, Mars, Venus, Mercury, transit, aspect, harmony, dissonance, asana, pranayama, meditation, chakra, planet of the day, window of opportunity.",
};

const AUTO_DETECT_DOMAIN_PROMPT =
  "Context: a conversation about yoga, psychology, chakras, meditation, pranayama, planets, natal charts and spiritual practices. Terms may appear in Russian, English or other European languages: Muladhara, Svadhishthana, Manipura, Anahata, Vishuddha, Ajna, Sahasrara, chakra, meditation, breathing, asana, planet of the day, transit, aspect, harmony, dissonance.";

export function getDomainPrompt(language?: string): string {
  if (!language) return AUTO_DETECT_DOMAIN_PROMPT;
  return WHISPER_DOMAIN_PROMPTS[language] ?? AUTO_DETECT_DOMAIN_PROMPT;
}

export function normalizeWhisperLanguage(language: string | undefined): string | undefined {
  const normalized = language?.trim().toLowerCase();
  if (!normalized) return undefined;
  return LANGUAGE_ALIASES[normalized] ?? LANGUAGE_ALIASES[normalized.slice(0, 2)];
}
