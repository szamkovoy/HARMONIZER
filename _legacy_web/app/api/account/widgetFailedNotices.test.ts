import { describe, expect, it } from "vitest";

import { getPayPageCopy } from "./payPageCopy";
import { buildWidgetFailedEmail, groupWidgetCandidates } from "./widgetFailedNotices";

const LOCALES = ["ru", "en", "de", "fr", "it", "es", "pt", "nl"] as const;

describe("widget failed-payment letter", () => {
  it("puts the subject, the landing button and the signature in the letter", () => {
    const copy = getPayPageCopy("ru");
    const payUrl = "https://zamkovoi.yoga/wbnr?hz_unpaid=widget-1";
    const letter = buildWidgetFailedEmail({ locale: "ru", payUrl });

    expect(letter.subject).toBe(copy.widgetFailedSubject);
    expect(letter.lang).toBe("ru");
    expect(letter.html).toContain(copy.widgetFailedButton);
    expect(letter.html).toContain(`href="${payUrl}"`);
    expect(letter.html).toContain("Всех благ!");
    expect(letter.html).toContain("Сергей Замковой");
    expect(letter.text).toContain(payUrl);
    expect(letter.text).toContain("Сергей Замковой");
  });

  it("has a subject, a body and a button in every locale", () => {
    for (const locale of LOCALES) {
      const copy = getPayPageCopy(locale);
      const letter = buildWidgetFailedEmail({ locale, payUrl: "https://example.test/pay" });
      expect(letter.subject.trim().length).toBeGreaterThan(0);
      expect(letter.html).toContain(copy.widgetFailedButton);
      expect(copy.widgetFailedBody.trim().length).toBeGreaterThan(0);
    }
  });

  it("sends one letter per email and ignores the address case", () => {
    const groups = groupWidgetCandidates([
      { buyer_email: "Buyer@Example.com", updated_at: "2026-11-15T01:00:00.000Z", id: "older" },
      { buyer_email: "buyer@example.com", updated_at: "2026-11-15T02:00:00.000Z", id: "newer" },
      { buyer_email: "other@example.com", updated_at: "2026-11-15T01:30:00.000Z", id: "other" },
      { buyer_email: "  ", updated_at: "2026-11-15T03:00:00.000Z", id: "blank" },
    ]);

    expect(groups).toHaveLength(2);
    const buyer = groups.find((group) => group.send.id === "newer");
    expect(buyer?.suppress.map((row) => row.id)).toEqual(["older"]);
    expect(groups.find((group) => group.send.id === "other")?.suppress).toEqual([]);
  });
});
