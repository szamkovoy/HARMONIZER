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
});
