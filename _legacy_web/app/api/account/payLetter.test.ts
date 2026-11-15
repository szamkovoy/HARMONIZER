import { describe, expect, it } from "vitest";

import { wrapMarketingEmailHtml } from "../_utils/emailTemplate";
import { buildPayLetterBody, greetingWithName } from "./payLetter";
import { getPayPageCopy } from "./payPageCopy";
import { buildPaymentFailedEmail } from "./paymentFailedNotices";
import { buildWidgetFailedEmail } from "./widgetFailedNotices";

describe("greetingWithName", () => {
  it("inserts the name before the trailing exclamation", () => {
    expect(greetingWithName("Здравствуйте!", "Сергей")).toBe("Здравствуйте, Сергей!");
    expect(greetingWithName("Bonjour !", "Sergei")).toBe("Bonjour, Sergei !");
  });

  it("leaves the greeting unchanged when there is no name", () => {
    expect(greetingWithName("Здравствуйте!", "")).toBe("Здравствуйте!");
    expect(greetingWithName("Здравствуйте!", null as unknown as string)).toBe("Здравствуйте!");
  });

  it("does not change a greeting that does not end with !", () => {
    expect(greetingWithName("Hola:", "Sergei")).toBe("Hola:");
  });
});

describe("buildPayLetterBody", () => {
  it("orders greeting, paid-for line, body, spacers, button and signature", () => {
    const copy = getPayPageCopy("ru");
    const url = "https://harmonizer.zamkovoi.yoga/pay/failed?t=abc&c=1";
    const { bodyHtml, text } = buildPayLetterBody({
      copy,
      text: "Здравствуйте!\n\nОплата не прошла.",
      buttonLabel: "Выбрать способ оплаты",
      buttonUrl: url,
      buttonColor: "#2E8B57",
      name: "Сергей",
      product: "Тарифный план «Наставник»",
    });

    expect(text).toContain("Здравствуйте, Сергей!");
    expect(text).toContain("Вы оплачивали: Тарифный план «Наставник»");
    expect(text.indexOf("Здравствуйте, Сергей!")).toBeLessThan(text.indexOf("Вы оплачивали:"));
    expect(text.indexOf("Вы оплачивали:")).toBeLessThan(text.indexOf("Оплата не прошла"));

    const greetingAt = bodyHtml.indexOf("Здравствуйте, Сергей!");
    const paidAt = bodyHtml.indexOf("Вы оплачивали:");
    const bodyAt = bodyHtml.indexOf("Оплата не прошла");
    const buttonAt = bodyHtml.indexOf("Выбрать способ оплаты");
    const signAt = bodyHtml.indexOf("Всех благ!");
    expect(greetingAt).toBeGreaterThanOrEqual(0);
    expect(greetingAt).toBeLessThan(paidAt);
    expect(paidAt).toBeLessThan(bodyAt);
    expect(bodyAt).toBeLessThan(buttonAt);
    expect(buttonAt).toBeLessThan(signAt);
    expect(bodyHtml).toContain("<p></p>");
    expect(bodyHtml).toContain("pay/failed?t=abc&amp;c=1");
  });

  it("omits the paid-for line when product is missing", () => {
    const copy = getPayPageCopy("ru");
    const { bodyHtml, text } = buildPayLetterBody({
      copy,
      text: "Здравствуйте!\n\nОплата не прошла.",
      buttonLabel: "Выбрать",
      buttonUrl: "https://example.test/pay",
      buttonColor: "#2E8B57",
    });
    expect(bodyHtml).not.toContain("Вы оплачивали:");
    expect(text).not.toContain("Вы оплачивали:");
  });

  it("keeps empty spacer paragraphs as divider rows after wrapMarketingEmailHtml", () => {
    const copy = getPayPageCopy("ru");
    const { bodyHtml } = buildPayLetterBody({
      copy,
      text: "Здравствуйте!\n\nОплата не прошла.",
      buttonLabel: "Кнопка",
      buttonUrl: "https://example.test/pay",
      buttonColor: "#2E8B57",
      product: "Участие в вебинаре",
    });
    const html = wrapMarketingEmailHtml({ bodyHtml, lang: "ru", footer: null });
    // Look around the button in the visible body (not the hidden preheader).
    const buttonIdx = html.lastIndexOf(">Кнопка</a>");
    const around = html.slice(Math.max(0, buttonIdx - 500), buttonIdx + 320);
    expect(around).toContain("Кнопка");
    // Empty <p></p> spacers become fixed-height divider rows with &nbsp; (not dropped).
    expect(around).toContain("height:1.55em");
    expect(around).toContain("&nbsp;");
  });
});

describe("failed letters name the purchase", () => {
  const url = "https://harmonizer.zamkovoi.yoga/pay/failed?t=abc";

  it("includes the oracle, webinar and book product lines", () => {
    const copy = getPayPageCopy("ru");
    const oracle = buildPaymentFailedEmail({ locale: "ru", tier: "oracle", payUrl: url, name: "Сергей" });
    const webinar = buildPaymentFailedEmail({ locale: "ru", tier: "webinar", payUrl: url });
    const book = buildPaymentFailedEmail({ locale: "ru", tier: "book", payUrl: url });

    expect(oracle.html).toContain("Здравствуйте, Сергей!");
    expect(oracle.html).toContain("Тарифный план «Наставник»");
    expect(webinar.html).toContain(copy.productWebinar);
    expect(book.html).toContain(copy.productBook);
  });

  it("includes the catalog product title for the widget letter", () => {
    const letter = buildWidgetFailedEmail({
      locale: "ru",
      payUrl: "https://zamkovoi.yoga/wbnr",
      name: "Анна",
      product: "Диагностика",
    });
    expect(letter.html).toContain("Здравствуйте, Анна!");
    expect(letter.html).toContain("Вы оплачивали: Диагностика");
  });
});
