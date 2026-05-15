import { describe, expect, it } from "vitest";
import { sanitizeAssistantText, stripDialogScaffoldMarkdown, validateHistoryHasDurationAndType } from "./markers";

describe("stripDialogScaffoldMarkdown", () => {
  it("removes horizontal rules and entire **…** blocks (not unwrapping)", () => {
    const raw =
      "---\n\n**Зеркало**\n\nТекст зеркала.\n\n**Темы**\n\nДальше.\n\nШея (то, о чём вы упомянули через боль) и плечи.";
    const out = stripDialogScaffoldMarkdown(raw);
    expect(out).toBe("Текст зеркала.\n\nДальше.\n\nШея (то, о чём вы упомянули через боль) и плечи.");
  });

  it("removes long **…** section titles", () => {
    const raw = "**Главная тема через призму чакры дня**\n\nАбзац.\n\n**Штрих глубины**\n\nКонец.";
    expect(stripDialogScaffoldMarkdown(raw)).toBe("Абзац.\n\nКонец.");
  });
});

describe("sanitizeAssistantText", () => {
  it("removes leaked hint markers from Russian assistant text", () => {
    const raw = `Не понял. Допустим, в голове отзывается. Что дальше?\n\n(Saturn/Voice hint), или, может, просто тихая нехватка ясности? Наговорите`;

    expect(sanitizeAssistantText(raw, "ru")).toBe(
      "Не понял. Допустим, в голове отзывается. Что дальше?\n\nили, может, просто тихая нехватка ясности? Наговорите",
    );
  });

  it("removes stray English gloss lines from Russian assistant text", () => {
    const raw = `прячется много шума, заметили?"\n(Sometimes behind silence hides a lot of noise, noticed?)\n* Call`;

    expect(sanitizeAssistantText(raw, "ru")).toBe(`прячется много шума, заметили?"`);
  });

  it("removes markdown scaffold: --- and entire **…** blocks", () => {
    const raw = "---\n\n**Зеркало**\n\nАбзац.\n\n**Темы**\n\nЕщё.";
    const out = sanitizeAssistantText(raw, "ru");
    expect(out).not.toContain("---");
    expect(out).not.toContain("**");
    expect(out).not.toContain("Зеркало");
    expect(out).toContain("Абзац");
  });
});

describe("validateHistoryHasDurationAndType", () => {
  it("parses «три четверти часа» as 45 minutes, not three hours", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "У меня три четверти часа, хочу асаны" },
    ]);
    expect(result.durationSec).toBe(45 * 60);
  });

  it("recognises word-form duration 'две минуты' + type 'медитацию'", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "буквально две минуты медитацию" },
    ]);
    expect(result.hasDuration).toBe(true);
    expect(result.hasType).toBe(true);
    expect(result.confident).toBe(true);
  });

  it("recognises 'пару минут' + type 'подышать'", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "пару минут подышать" },
    ]);
    expect(result.hasDuration).toBe(true);
  });

  it("recognises digit duration '15 минут' + type 'йогу'", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "15 минут йогу" },
    ]);
    expect(result.hasDuration).toBe(true);
    expect(result.hasType).toBe(true);
    expect(result.confident).toBe(true);
  });

  it("recognises explicit first-message practice requests from packet B", () => {
    const samples = [
      "Я хочу выполнить дыхание в течение 15 минут",
      "дыхание 15 минут",
      "Просто предложи мне практику асан 25 минут",
      "Я хочу выполнить асаны 25 минут",
    ];

    for (const sample of samples) {
      const result = validateHistoryHasDurationAndType([{ role: "user", content: sample }]);
      expect(result.hasDuration, sample).toBe(true);
      expect(result.hasType, sample).toBe(true);
      expect(result.confident, sample).toBe(true);
    }
  });

  it("extracts durationSec and practiceKind: 'две минуты медитацию'", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "буквально две минуты медитацию" },
    ]);
    expect(result.durationSec).toBe(120);
    expect(result.practiceKind).toBe("meditation");
  });

  it("extracts durationSec and practiceKind: '15 минут йогу'", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "15 минут йогу" },
    ]);
    expect(result.durationSec).toBe(900);
    expect(result.practiceKind).toBe("yoga");
  });

  it("extracts durationSec from 'полчаса' and practiceKind 'подышать'", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "полчаса подышать" },
    ]);
    expect(result.durationSec).toBe(1800);
    expect(result.practiceKind).toBe("breath");
  });

  it("extracts durationSec from 'пять минут'", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "пять минут пранаяму" },
    ]);
    expect(result.durationSec).toBe(300);
    expect(result.practiceKind).toBe("breath");
  });

  it("uses last mentioned values when user changes mind across messages", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "хочу 3 минуты медитацию" },
      { role: "assistant", content: "хорошо, 3 минуты медитации" },
      { role: "user", content: "нет, лучше 5 минут дыхание" },
    ]);
    expect(result.durationSec).toBe(300);
    expect(result.practiceKind).toBe("breath");
  });

  it("returns null for durationSec/practiceKind when not mentioned", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "привет, как дела" },
    ]);
    expect(result.durationSec).toBeNull();
    expect(result.practiceKind).toBeNull();
    expect(result.confident).toBe(false);
  });

  it("extracts 'час' as 3600 sec", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "час йоги" },
    ]);
    expect(result.durationSec).toBe(3600);
    expect(result.practiceKind).toBe("yoga");
  });

  it("extracts 'четверть часа' as 900 sec", () => {
    const result = validateHistoryHasDurationAndType([
      { role: "user", content: "четверть часа помедитировать" },
    ]);
    expect(result.durationSec).toBe(900);
    expect(result.practiceKind).toBe("meditation");
  });

  it("does not treat 'подышать или через тело' as exclusive breath (keeps yoga from earlier message)", () => {
    const result = validateHistoryHasDurationAndType([
      {
        role: "user",
        content: "хочу практику йоги для разговора с шефом",
      },
      {
        role: "user",
        content: "мне все равно подышать или через тело. посоветуй что лучше",
      },
      { role: "user", content: "минут 15-20 хотелось бы." },
    ]);
    expect(result.practiceKind).toBe("yoga");
    expect(result.durationSec).toBe(1080);
  });
});
