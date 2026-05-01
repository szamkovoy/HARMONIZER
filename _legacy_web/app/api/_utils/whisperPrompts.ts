export const WHISPER_DOMAIN_PROMPTS: Record<string, string> = {
  ru: "Контекст: разговор о йоге, психологии, чакрах и духовных практиках. Используются термины: Муладхара, Свадхистхана, Манипура, Анахата, Вишуддха, Аджна, Сахасрара. Также: натальная карта, Сатурн, Юпитер, Марс, Венера, Меркурий, транзит, аспект, дисгармония, гармония, асана, пранаяма, медитация, чакра, планета дня, окно возможностей.",
  en: "Context: a conversation about yoga, psychology, chakras and spiritual practices. Terms used include: Muladhara, Svadhishthana, Manipura, Anahata, Vishuddha, Ajna, Sahasrara, natal chart, Saturn, Jupiter, Mars, Venus, Mercury, transit, aspect, harmony, dissonance, asana, pranayama, meditation, chakra, planet of the day, window of opportunity.",
};

export function getDomainPrompt(language: string): string {
  return WHISPER_DOMAIN_PROMPTS[language] ?? WHISPER_DOMAIN_PROMPTS.ru;
}

export function normalizeWhisperLanguage(language: string | undefined): "ru" | "en" {
  const code = language?.trim().toLowerCase().slice(0, 2);
  return code === "en" ? "en" : "ru";
}
