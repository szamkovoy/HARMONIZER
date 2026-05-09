import { describe, expect, it } from "vitest";
import { formatAuthorVoiceForPrompt, getAuthorVoice } from "./authorVoice";

describe("getAuthorVoice", () => {
  it("returns Russian profile for ru locale", () => {
    const voice = getAuthorVoice("ru");

    expect(voice.archetype).toContain("Внутренний собеседник");
    expect(voice.usage_note).toContain("резерв");
    expect(voice.preferred_lexicon.openers_neutral).toContain("Слушай");
    expect(voice.preferred_lexicon.openers_observational).toContain("Похоже");
    expect(voice.forbidden).toContain("Прокачайте свою чакру");
  });

  it("returns English profile for en locale", () => {
    const voice = getAuthorVoice("en");

    expect(voice.archetype).toContain("Inner companion");
    expect(voice.usage_note).toContain("reserve");
    expect(voice.preferred_lexicon.openers_neutral).toContain("Listen");
    expect(voice.preferred_lexicon.openers_observational).toContain("Looks like");
    expect(voice.forbidden).toContain("Open your chakra");
  });

  it("falls back to Russian for unknown locale", () => {
    const voice = getAuthorVoice("xx");

    expect(voice.preferred_lexicon.openers_neutral).toContain("Слушай");
  });

  it("contains all few-shot examples", () => {
    const voice = getAuthorVoice("ru");

    expect(voice.few_shot_examples).toHaveLength(5);
    for (const example of voice.few_shot_examples) {
      expect(example).toHaveProperty("user_says");
      expect(example).toHaveProperty("assistant_should_NOT_say");
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
      "=== ПРИМЕЧАНИЕ К ПРОФИЛЮ ===",
      "=== ЦЕННОСТЬ В ОСНОВЕ ===",
      "=== ЛЮБИМЫЕ ОБОРОТЫ ===",
      "=== РИТМ ===",
      "=== ЗАПРЕЩЕНО ===",
      "=== ОБРАЩЕНИЕ ===",
      "=== ПРИМЕРЫ ===",
    ];

    for (const section of sections) {
      expect(formatted.match(new RegExp(section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(1);
    }
  });

  it("renders both opener lists in lexicon block", () => {
    const formatted = formatAuthorVoiceForPrompt(getAuthorVoice("ru"), "ty");

    expect(formatted).toContain("Зачины (нейтральные):");
    expect(formatted).toContain("Зачины (наблюдательные):");
    expect(formatted).toMatch(/Зачины \(нейтральные\):.*Слушай/);
    expect(formatted).toMatch(/Зачины \(наблюдательные\):.*Похоже/);
  });

  it("includes usage_note body in output", () => {
    const formatted = formatAuthorVoiceForPrompt(getAuthorVoice("ru"), "ty");

    expect(formatted).toContain("Не более одного зачина");
  });

  it("includes all five few-shot examples", () => {
    const formatted = formatAuthorVoiceForPrompt(getAuthorVoice("ru"), "ty");

    expect(formatted).toContain('ПРИМЕР 1:\nПользователь: "Я устал, и у меня нет сил что-либо делать"');
    expect(formatted).toContain('ПРИМЕР 2:\nПользователь: "Сегодня плохой день, всё бесит"');
    expect(formatted).toContain('ПРИМЕР 3:\nПользователь: "Не хочу делать практику сегодня, лень"');
    expect(formatted).toContain('ПРИМЕР 4:\nПользователь: "У меня в груди давит уже неделю, не понимаю почему"');
    expect(formatted).toContain('ПРИМЕР 5:\nПользователь: "Завтра презентация, переживаю"');
  });
});
