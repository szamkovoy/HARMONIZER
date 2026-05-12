import { describe, expect, it } from "vitest";
import { sanitizeAssistantText, validateHistoryHasDurationAndType } from "./markers";

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
});

describe("validateHistoryHasDurationAndType", () => {
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
});
