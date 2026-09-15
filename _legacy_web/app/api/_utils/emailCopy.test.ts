import { describe, expect, it } from "vitest";

import { resolveExactEmailCopy, resolveCampaignEmailCopy, isEmailCopyEmpty, MARKETING_CAMPAIGN_FORCE_COPY_LOCALE } from "./emailCopy";

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

describe("resolveCampaignEmailCopy", () => {
  const source = {
    subject: "Тема RU",
    htmlBody: "<p>Тело RU</p>",
    subjectI18n: { en: "Subject EN", fr: "Sujet FR" },
    htmlBodyI18n: { en: "<p>Body EN</p>", fr: "<p>Corps FR</p>" },
  };

  it("sends RU to every contact while the force-locale stub is on", () => {
    expect(MARKETING_CAMPAIGN_FORCE_COPY_LOCALE).toBe("ru");
    expect(resolveCampaignEmailCopy("en", source)?.locale).toBe("ru");
    expect(resolveCampaignEmailCopy("de", source)?.subject).toBe("Тема RU");
    expect(resolveCampaignEmailCopy("es", source)?.htmlBody).toContain("Тело RU");
  });
});

describe("isEmailCopyEmpty", () => {
  it("is true for a blank draft (no subject/body in any locale)", () => {
    expect(
      isEmailCopyEmpty({
        subject: "",
        htmlBody: "",
        subjectI18n: {},
        htmlBodyI18n: {},
      }),
    ).toBe(true);
  });

  it("is false when RU copy is authored", () => {
    expect(
      isEmailCopyEmpty({
        subject: "Тема",
        htmlBody: "<p>Тело</p>",
        subjectI18n: {},
        htmlBodyI18n: {},
      }),
    ).toBe(false);
  });
});
