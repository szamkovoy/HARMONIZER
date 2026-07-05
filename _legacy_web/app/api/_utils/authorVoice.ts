import authorVoiceData from "../../../data/author_voice.json";

type SupportedLanguage = "ru" | "en";

export interface AuthorVoiceProfile {
  archetype: string;
  usage_note: string;
  preferred_lexicon: {
    openers_neutral: string[];
    openers_observational: string[];
    transition_phrases: string[];
    state_words: string[];
    metaphor_seeds: string[];
    concluding_punches: string[];
  };
  forbidden: string[];
  rhythm_rules: string[];
  core_value: string;
  few_shot_examples: Array<{
    user_says: string;
    assistant_should_NOT_say: string;
    assistant_SHOULD_say: string;
    why: string;
  }>;
}

type AuthorVoiceJson = {
  version: number;
  archetype: Record<SupportedLanguage, string>;
  usage_note: Record<SupportedLanguage, string>;
  preferred_lexicon: Record<SupportedLanguage, AuthorVoiceProfile["preferred_lexicon"]>;
  forbidden: Record<SupportedLanguage, string[]>;
  rhythm_rules: Record<SupportedLanguage, string[]>;
  core_value: Record<SupportedLanguage, string>;
  few_shot_examples: AuthorVoiceProfile["few_shot_examples"];
};

const data = authorVoiceData as AuthorVoiceJson;

/** Локали, под которые есть профиль авторского голоса (ru) или переиспользуется EN-каденс. */
const VOICE_SUPPORTED_LOCALES = new Set(["ru", "en", "de", "fr", "it", "es", "pt", "nl"]);

function normalizeLanguage(language: string | null | undefined): SupportedLanguage {
  const normalized = language?.trim().toLowerCase() ?? "";
  if (normalized.startsWith("ru")) return "ru";
  // EN-каденс переиспользуется для самого EN и поддерживаемых европейских локалей
  // без нативного профиля (de/fr/it/es/pt/nl).
  if (
    normalized.startsWith("en") ||
    VOICE_SUPPORTED_LOCALES.has(normalized) ||
    VOICE_SUPPORTED_LOCALES.has(normalized.slice(0, 2))
  ) {
    return "en";
  }
  // Неизвестная/отсутствующая локаль → русский (i18n: русский — источник истины и конечный fallback).
  return "ru";
}

export function getAuthorVoice(language: string | null | undefined): AuthorVoiceProfile {
  const lang = normalizeLanguage(language);

  return {
    archetype: data.archetype[lang],
    usage_note: data.usage_note[lang],
    preferred_lexicon: data.preferred_lexicon[lang],
    forbidden: data.forbidden[lang],
    rhythm_rules: data.rhythm_rules[lang],
    core_value: data.core_value[lang],
    few_shot_examples: data.few_shot_examples,
  };
}

export function formatAuthorVoiceForPrompt(voice: AuthorVoiceProfile, addressForm: "ty" | "vy"): string {
  const exampleBlocks = voice.few_shot_examples
    .map(
      (example, index) => `
ПРИМЕР ${index + 1}:
Пользователь: "${example.user_says}"
ТАК НЕ НАДО: "${example.assistant_should_NOT_say}"
ТАК НАДО: "${example.assistant_SHOULD_say}"
Почему: ${example.why}
`,
    )
    .join("\n");

  return `
=== АРХЕТИП ===
${voice.archetype}

=== ПРИМЕЧАНИЕ К ПРОФИЛЮ ===
${voice.usage_note}

=== ЦЕННОСТЬ В ОСНОВЕ ===
${voice.core_value}

=== ЛЮБИМЫЕ ОБОРОТЫ ===
Зачины (нейтральные): ${voice.preferred_lexicon.openers_neutral.join(", ")}
Зачины (наблюдательные): ${voice.preferred_lexicon.openers_observational.join(", ")}
Переходы: ${voice.preferred_lexicon.transition_phrases.join(", ")}
Слова состояний: ${voice.preferred_lexicon.state_words.join(", ")}
Семена метафор: ${voice.preferred_lexicon.metaphor_seeds.join(", ")}
Точки-утверждения: ${voice.preferred_lexicon.concluding_punches.join(", ")}

=== РИТМ ===
${voice.rhythm_rules.map((rule) => `• ${rule}`).join("\n")}

=== ЗАПРЕЩЕНО ===
${voice.forbidden.map((item) => `❌ ${item}`).join("\n")}

=== ОБРАЩЕНИЕ ===
Используй ${addressForm === "ty" ? "«ты»" : "«вы»"} как форму обращения. ${
    addressForm === "ty" ? "Это создаёт близость и снимает дистанцию." : "Это уважительная, но тёплая форма."
  }

=== ПРИМЕРЫ ===
${exampleBlocks}
`.trim();
}
