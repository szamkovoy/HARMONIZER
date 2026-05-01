import { describe, expect, it } from "vitest";
import { formatAuthorVoiceForPrompt, getAuthorVoice } from "./authorVoice";

describe("getAuthorVoice", () => {
  it("returns Russian profile for ru locale", () => {
    const voice = getAuthorVoice("ru");

    expect(voice.archetype).toContain("Рассказчик");
    expect(voice.preferred_lexicon.openers).toContain("Слушай");
    expect(voice.forbidden).toContain("Прокачайте свою чакру");
  });

  it("returns English profile for en locale", () => {
    const voice = getAuthorVoice("en");

    expect(voice.archetype).toContain("Storyteller");
    expect(voice.preferred_lexicon.openers).toContain("Listen");
    expect(voice.forbidden).toContain("Open your chakra");
  });

  it("falls back to Russian for unknown locale", () => {
    const voice = getAuthorVoice("xx");

    expect(voice.preferred_lexicon.openers).toContain("Слушай");
  });

  it("contains all few-shot examples", () => {
    const voice = getAuthorVoice("ru");

    expect(voice.few_shot_examples).toHaveLength(4);
    for (const example of voice.few_shot_examples) {
      expect(example).toHaveProperty("user_says");
      expect(example).toHaveProperty("assistant_SHOULD_say");
      expect(example).toHaveProperty("why");
    }
  });
});

describe("formatAuthorVoiceForPrompt", () => {
  it("formats profile with ty address", () => {
    const formatted = formatAuthorVoiceForPrompt(getAuthorVoice("ru"), "ty");

    expect(formatted).toContain("«ты»");
    expect(formatted).not.toContain("«вы» как форму обращения");
  });

  it("formats profile with vy address", () => {
    const formatted = formatAuthorVoiceForPrompt(getAuthorVoice("ru"), "vy");

    expect(formatted).toContain("«вы»");
  });

  it("includes each expected section exactly once", () => {
    const formatted = formatAuthorVoiceForPrompt(getAuthorVoice("ru"), "ty");
    const sections = [
      "=== АРХЕТИП ===",
      "=== ЦЕННОСТЬ В ОСНОВЕ ===",
      "=== СТРУКТУРНЫЕ ПАТТЕРНЫ РЕЧИ ===",
      "=== ЛЮБИМЫЕ ОБОРОТЫ ===",
      "=== РИТМ ===",
      "=== ТЕЛЕСНЫЙ ЯЗЫК ===",
      "=== ЗАПРЕЩЕНО ===",
      "=== ОБРАЩЕНИЕ ===",
      "=== ПРИМЕРЫ ===",
    ];

    for (const section of sections) {
      expect(formatted.match(new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(1);
    }
  });

  it("includes all examples instead of enforcing a hard character budget", () => {
    const formatted = formatAuthorVoiceForPrompt(getAuthorVoice("ru"), "ty");

    expect(formatted).toContain('ПРИМЕР 1:\nПользователь: "Я устал, и у меня нет сил что-либо делать"');
    expect(formatted).toContain('ПРИМЕР 2:\nПользователь: "Сегодня плохой день, всё бесит"');
    expect(formatted).toContain('ПРИМЕР 3:\nПользователь: "Не хочу делать практику сегодня, лень"');
    expect(formatted).toContain('ПРИМЕР 4:\nПользователь: "Кажется, я зашёл в тупик, не понимаю что делать дальше"');
  });
});
