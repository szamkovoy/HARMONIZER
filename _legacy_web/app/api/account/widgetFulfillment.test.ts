import { describe, expect, it } from "vitest";

import { wrapMarketingEmailHtml } from "../_utils/emailTemplate";
import { plainLetterToHtml, webinarPassWindow } from "./widgetFulfillment";

describe("webinarPassWindow", () => {
  const windowOf = (paid: string) => webinarPassWindow(new Date(paid), 28);
  const counts = (paid: string, webinar: string) => {
    const { from, until } = windowOf(paid);
    const t = new Date(webinar).getTime();
    return t >= from.getTime() && t < until.getTime();
  };

  it("28 days counted to the minute from payment", () => {
    // Paid 3 Oct 15:00 → the 31 Oct 11:00 webinar is inside (until 31 Oct 15:00).
    expect(counts("2026-10-03T15:00:00+03:00", "2026-10-31T11:00:00+03:00")).toBe(true);
    // Paid 3 Oct 10:00 → window ends 31 Oct 10:00, the 11:00 webinar is outside.
    expect(counts("2026-10-03T10:00:00+03:00", "2026-10-31T11:00:00+03:00")).toBe(false);
    // A webinar that started before payment never counts.
    expect(counts("2026-10-03T15:00:00+03:00", "2026-10-03T11:00:00+03:00")).toBe(false);
  });
});

describe("plainLetterToHtml", () => {
  it("paragraphs, line breaks, escaped HTML and clickable links", () => {
    const html = plainLetterToHtml("Привет, {{name}}!\n\nСсылка: https://zamkovoi.yoga/x\nвторая <b>строка</b>");
    expect(html).toContain("<p>Привет, {{name}}!</p>\n<p></p>\n<p>Ссылка:");
    expect(html).toContain('<a href="https://zamkovoi.yoga/x"');
    expect(html).toContain("<br />");
    expect(html).toContain("&lt;b&gt;");
  });

  it("turns each blank line into a gap and keeps a single break inside a paragraph", () => {
    expect(plainLetterToHtml("Первый абзац.\n\nВторой абзац.")).toBe(
      "<p>Первый абзац.</p>\n<p></p>\n<p>Второй абзац.</p>",
    );
    expect(plainLetterToHtml("До встречи!\nСергей Замковой")).toBe(
      "<p>До встречи!<br />Сергей Замковой</p>",
    );
    const wrapped = wrapMarketingEmailHtml({
      bodyHtml: plainLetterToHtml("Первый абзац.\n\nВторой абзац."),
      footer: null,
      lang: "ru",
    });
    expect(wrapped).toContain("height:1.55em");
    expect(wrapped).not.toContain("отписаться");
    expect(wrapped).not.toContain("border-top:1px solid");
  });
});
