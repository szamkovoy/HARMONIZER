import { describe, expect, it } from "vitest";

import { resolveExactEmailCopy } from "./emailCopy";

describe("resolveExactEmailCopy", () => {
  const source = {
    subject: "Тема RU",
    htmlBody: "<p>Тело RU</p>",
    subjectI18n: { en: "Subject EN", fr: "Sujet FR" },
    htmlBodyI18n: { en: "<p>Body EN</p>", fr: "<p>Corps FR</p>" },
  };

  it("returns RU copy for ru contact", () => {
    const copy = resolveExactEmailCopy("ru", source);
    expect(copy?.locale).toBe("ru");
    expect(copy?.subject).toBe("Тема RU");
    expect(copy?.htmlBody).toContain("Тело RU");
  });

  it("returns FR copy for fr contact", () => {
    const copy = resolveExactEmailCopy("fr", source);
    expect(copy?.locale).toBe("fr");
    expect(copy?.subject).toBe("Sujet FR");
  });

  it("returns null when locale has no translation (no fallback)", () => {
    expect(resolveExactEmailCopy("es", source)).toBeNull();
    expect(resolveExactEmailCopy("de", source)).toBeNull();
  });

  it("returns null when subject exists but html empty for locale", () => {
    expect(
      resolveExactEmailCopy("it", {
        subject: "RU",
        htmlBody: "<p>RU</p>",
        subjectI18n: { it: "IT subject" },
        htmlBodyI18n: {},
      }),
    ).toBeNull();
  });
});
