import authorVoiceData from "../../../data/author_voice.json";

type SupportedLanguage = "ru" | "en";

export interface AuthorVoiceProfile {
  archetype: string;
  structural_patterns: string[];
  preferred_lexicon: {
    openers: string[];
    transition_phrases: string[];
    state_words: string[];
    metaphor_seeds: string[];
    concluding_punches: string[];
  };
  forbidden: string[];
  rhythm_rules: string[];
  somatic_language: string[];
  core_value: string;
  few_shot_examples: Array<{
    user_says: string;
    assistant_should_NOT_say: string;
    assistant_SHOULD_say: string;
    why: string;
  }>;
}

function normalizeLanguage(language: string | null | undefined): SupportedLanguage {
  const normalized = language?.trim().toLowerCase() ?? "";
  if (normalized.startsWith("en")) return "en";
  return "ru";
}

export function getAuthorVoice(language: string | null | undefined): AuthorVoiceProfile {
  const lang = normalizeLanguage(language);

  return {
    archetype: authorVoiceData.archetype[lang],
    structural_patterns: authorVoiceData.structural_patterns[lang],
    preferred_lexicon: authorVoiceData.preferred_lexicon[lang],
    forbidden: authorVoiceData.forbidden[lang],
    rhythm_rules: authorVoiceData.rhythm_rules[lang],
    somatic_language: authorVoiceData.somatic_language[lang],
    core_value: authorVoiceData.core_value[lang],
    few_shot_examples: authorVoiceData.few_shot_examples,
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

=== ЦЕННОСТЬ В ОСНОВЕ ===
${voice.core_value}

=== СТРУКТУРНЫЕ ПАТТЕРНЫ РЕЧИ ===
${voice.structural_patterns.map((pattern) => `• ${pattern}`).join("\n")}

=== ЛЮБИМЫЕ ОБОРОТЫ ===
Зачины: ${voice.preferred_lexicon.openers.join(", ")}
Переходы: ${voice.preferred_lexicon.transition_phrases.join(", ")}
Слова состояний: ${voice.preferred_lexicon.state_words.join(", ")}
Семена метафор: ${voice.preferred_lexicon.metaphor_seeds.join(", ")}
Точки-утверждения: ${voice.preferred_lexicon.concluding_punches.join(", ")}

=== РИТМ ===
${voice.rhythm_rules.map((rule) => `• ${rule}`).join("\n")}

=== ТЕЛЕСНЫЙ ЯЗЫК ===
${voice.somatic_language.map((item) => `• ${item}`).join("\n")}

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
