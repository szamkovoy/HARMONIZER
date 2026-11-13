import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { yookassaFailureReason } from "./fulfillPaymentContract";
import { buildPassReminderEmail } from "./passReminders";
import { fillPayCopy, formatPayDate, getPayPageCopy } from "./payPageCopy";
import {
  buildFailedActions,
  buildOneTimeActions,
  buildRenewActions,
  failedPageText,
  renderPayPage,
  retryChoice,
} from "./payPages";
import {
  signOneTimeRetryToken,
  signPayRetryToken,
  verifyOneTimeRetryToken,
  verifyPayRetryToken,
  type PayRetryPayload,
} from "./payRetryToken";
import { hasHigherPaidAccess, tierPassPeriodEnd } from "./tierPass";

const LOCALES = ["ru", "en", "de", "fr", "it", "es", "pt", "nl"] as const;
const DAY = 24 * 60 * 60 * 1000;
const NO_BLOCKS = { subscription: null, pass: null };

describe("tierPassPeriodEnd", () => {
  const paidAt = new Date("2026-11-08T12:00:00.000Z");

  it("gives 30 days from payment without a grace period", () => {
    expect(tierPassPeriodEnd({ tier: "oracle", paidAt }).getTime()).toBe(paidAt.getTime() + 30 * DAY);
  });

  it("extends the same tier from its current end", () => {
    const currentEnd = new Date(paidAt.getTime() + 5 * DAY).toISOString();
    const end = tierPassPeriodEnd({ tier: "master", paidAt, currentTier: "master", currentExpiresAt: currentEnd });
    expect(end.getTime()).toBe(paidAt.getTime() + 35 * DAY);
  });

  it("does not stack on another tier or an expired period", () => {
    const later = new Date(paidAt.getTime() + 5 * DAY).toISOString();
    const earlier = new Date(paidAt.getTime() - DAY).toISOString();
    expect(
      tierPassPeriodEnd({ tier: "master", paidAt, currentTier: "oracle", currentExpiresAt: later }).getTime(),
    ).toBe(paidAt.getTime() + 30 * DAY);
    expect(
      tierPassPeriodEnd({ tier: "oracle", paidAt, currentTier: "oracle", currentExpiresAt: earlier }).getTime(),
    ).toBe(paidAt.getTime() + 30 * DAY);
  });
});

describe("hasHigherPaidAccess", () => {
  const now = new Date("2026-11-08T12:00:00.000Z");
  const future = new Date(now.getTime() + DAY).toISOString();

  it("blocks a lower pass while a higher tier is still paid", () => {
    expect(hasHigherPaidAccess({ tier: "oracle", currentTier: "master", currentExpiresAt: future, now })).toBe(true);
  });

  it("allows the same or a higher tier, and expired access", () => {
    expect(hasHigherPaidAccess({ tier: "oracle", currentTier: "oracle", currentExpiresAt: future, now })).toBe(false);
    expect(hasHigherPaidAccess({ tier: "master", currentTier: "oracle", currentExpiresAt: future, now })).toBe(false);
    expect(
      hasHigherPaidAccess({ tier: "oracle", currentTier: "master", currentExpiresAt: "2026-11-01T00:00:00Z", now }),
    ).toBe(false);
    expect(hasHigherPaidAccess({ tier: "oracle", currentTier: "free", currentExpiresAt: null, now })).toBe(false);
  });
});

describe("pay retry token", () => {
  const prev = process.env.ACCOUNT_CABINET_SECRET;
  beforeEach(() => {
    process.env.ACCOUNT_CABINET_SECRET = "test-secret";
  });
  afterEach(() => {
    process.env.ACCOUNT_CABINET_SECRET = prev;
  });

  const payload = {
    userId: "8f0c7a1e-0000-4000-8000-000000000001",
    tier: "master" as const,
    kind: "subscription" as const,
    currency: "EUR" as const,
    country: "DE",
    locale: "de",
  };

  it("round-trips everything a new invoice needs", () => {
    const now = Date.parse("2026-11-08T12:00:00Z");
    const token = signPayRetryToken(payload, DAY, now);
    expect(verifyPayRetryToken(token, now + 1000)).toEqual({ ...payload, exp: now + DAY });
  });

  it("still reads a tier token, and does not read it as a one-time purchase", () => {
    const now = Date.parse("2026-11-08T12:00:00Z");
    const token = signPayRetryToken(payload, DAY, now);
    expect(verifyPayRetryToken(token, now + 1000)).toEqual({ ...payload, exp: now + DAY });
    expect(verifyOneTimeRetryToken(token, now + 1000)).toBeNull();
  });

  it("round-trips a webinar and a book, and rejects them as a tier token", () => {
    const now = Date.parse("2026-11-08T12:00:00Z");
    const webinar = {
      userId: payload.userId,
      product: "webinar" as const,
      webinarId: "9c1e0b2a-1111-4222-8333-444444444444",
      currency: "RUB" as const,
      country: "RU",
      locale: "ru",
    };
    const book = {
      userId: payload.userId,
      product: "book" as const,
      webinarId: null,
      currency: "EUR" as const,
      country: null,
      locale: "en",
    };
    const webinarToken = signOneTimeRetryToken(webinar, DAY, now);
    const bookToken = signOneTimeRetryToken(book, DAY, now);
    expect(verifyOneTimeRetryToken(webinarToken, now + 1000)).toEqual({ ...webinar, exp: now + DAY });
    expect(verifyOneTimeRetryToken(bookToken, now + 1000)).toEqual({ ...book, exp: now + DAY });
    expect(verifyPayRetryToken(webinarToken, now + 1000)).toBeNull();
    expect(verifyPayRetryToken(bookToken, now + 1000)).toBeNull();
  });

  it("rejects a tampered or expired token", () => {
    const now = Date.parse("2026-11-08T12:00:00Z");
    const token = signPayRetryToken(payload, DAY, now);
    const [body, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), s: "someone-else" }),
    ).toString("base64url");
    expect(verifyPayRetryToken(`${forged}.${sig}`, now)).toBeNull();
    expect(verifyPayRetryToken(token, now + DAY + 1)).toBeNull();
    expect(verifyPayRetryToken("", now)).toBeNull();
  });
});

describe("failure page options", () => {
  const copy = getPayPageCopy("ru");

  it("offers another card, PayPal and 30 days after a failed subscription", () => {
    expect(buildFailedActions({ kind: "subscription", blocks: NO_BLOCKS, paypal: true, copy })).toEqual([
      { label: "Оплатить другой картой", option: "card" },
      { label: "Оплатить через PayPal", option: "paypal" },
      { label: "Оплатить 30 дней без автопродления", option: "pass" },
    ]);
  });

  it("hides PayPal for RUB / YooKassa and 30 days after a failed 30-day payment", () => {
    expect(buildFailedActions({ kind: "subscription", blocks: NO_BLOCKS, paypal: false, copy })).toEqual([
      { label: "Оплатить другой картой", option: "card" },
      { label: "Оплатить 30 дней без автопродления", option: "pass" },
    ]);
    expect(buildFailedActions({ kind: "pass", blocks: NO_BLOCKS, paypal: true, copy })).toEqual([
      { label: "Оплатить другой картой", option: "card" },
      { label: "Оплатить через PayPal", option: "paypal" },
    ]);
  });

  it("uses the given label on the first retry button", () => {
    expect(
      buildFailedActions({
        kind: "subscription",
        blocks: NO_BLOCKS,
        paypal: false,
        copy,
        retryLabel: copy.payAgain,
      }),
    ).toEqual([
      { label: "Оплатить ещё раз", option: "card" },
      { label: "Оплатить 30 дней без автопродления", option: "pass" },
    ]);
  });

  it("offers pay again, a foreign card and PayPal for a one-time purchase", () => {
    expect(buildOneTimeActions({ paypal: false, foreignCard: false, copy })).toEqual([
      { label: "Оплатить ещё раз", option: "card" },
    ]);
    expect(buildOneTimeActions({ paypal: true, foreignCard: false, copy })).toEqual([
      { label: "Оплатить ещё раз", option: "card" },
      { label: "Оплатить через PayPal", option: "paypal" },
    ]);
    expect(buildOneTimeActions({ paypal: true, foreignCard: true, copy })).toEqual([
      { label: "Оплатить ещё раз", option: "card" },
      { label: "Оплатить картой иностранного банка", option: "foreign" },
      { label: "Оплатить через PayPal", option: "paypal" },
    ]);
  });

  it("picks the page text from how the attempt ended", () => {
    expect(failedPageText(copy, "abandoned")).toEqual({
      title: copy.incompleteTitle,
      body: copy.incompleteBody,
    });
    expect(failedPageText(copy, "declined_3ds")).toEqual({
      title: copy.failedTitle,
      body: copy.failedBody,
    });
    expect(failedPageText(copy, "declined")).toEqual({
      title: copy.failedTitle,
      body: copy.failedBodyGeneric,
    });
  });

  it("offers a foreign-bank card after a YooKassa decline", () => {
    expect(
      buildFailedActions({ kind: "subscription", blocks: NO_BLOCKS, paypal: false, foreignCard: true, copy }),
    ).toEqual([
      { label: "Оплатить другой картой", option: "card" },
      { label: "Оплатить картой иностранного банка", option: "foreign" },
      { label: "Оплатить 30 дней без автопродления", option: "pass" },
    ]);
  });

  it("sends a buyer whose retry already went through to the cabinet", () => {
    expect(
      buildFailedActions({ kind: "subscription", blocks: { subscription: "already_active", pass: "already_active" }, paypal: true, copy }),
    ).toBe("already_active");
  });

  it("renews with 30 days first, then subscription", () => {
    expect(buildRenewActions({ blocks: NO_BLOCKS, paypal: false, copy }).valueOf()).toEqual([
      { label: "Оплатить ещё 30 дней", option: "pass" },
      { label: "Оформить подписку с автопродлением", option: "subscription" },
    ]);
  });

  it("maps buttons to the next purchase", () => {
    const token = { kind: "subscription" } as PayRetryPayload;
    expect(retryChoice(token, "card")).toEqual({ kind: "subscription", paypal: false });
    expect(retryChoice(token, "paypal")).toEqual({ kind: "subscription", paypal: true });
    expect(retryChoice(token, "pass")).toEqual({ kind: "pass", paypal: false });
    expect(retryChoice({ kind: "pass" } as PayRetryPayload, "paypal")).toEqual({ kind: "pass", paypal: true });
    expect(retryChoice(token, "foreign")).toEqual({ kind: "subscription", paypal: false, foreign: true });
    expect(retryChoice(token, "anything")).toBeNull();
  });

  it("renders forms that post the token and escape text", async () => {
    const res = renderPayPage({
      lang: "ru",
      title: copy.failedTitle,
      body: copy.failedBody,
      token: 'a"b',
      actions: [{ label: "<x>", option: "card" }],
    });
    const html = await res.text();
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(html).toContain('action="/pay/retry"');
    expect(html).toContain('value="a&quot;b"');
    expect(html).toContain("&lt;x&gt;");
    expect(html).toContain("<h1>Оплата не удалась</h1>");
  });
});

describe("pay page copy", () => {
  it("keeps the authored Russian text", () => {
    const ru = getPayPageCopy("ru");
    expect(ru.failedBody).toBe(
      "К сожалению, оплата не была проведена. Так бывает, если код подтверждения платежа введён неверно, либо ваша банковская карта не поддерживает 3‑D Secure (то есть подтверждение платежей). Выберите, как вы хотите продолжить:",
    );
  });

  it.each(LOCALES)("%s: every string is filled and placeholders survive", (locale) => {
    const copy = getPayPageCopy(locale);
    expect(copy.lang).toBe(locale);
    for (const [key, value] of Object.entries(copy)) {
      expect(value, key).toBeTruthy();
    }
    expect(copy.renewBody).toContain("{tier}");
    expect(copy.renewBody).toContain("{date}");
    expect(copy.reminderBody).toContain("{tier}");
    expect(copy.reminderBody).toMatch(/12/);
    expect(copy.reminderSubject).toMatch(/12/);
    if (locale !== "ru") expect(copy.failedTitle).not.toBe(getPayPageCopy("ru").failedTitle);
  });

  it("falls back to Russian for an unknown locale", () => {
    expect(getPayPageCopy("ja").lang).toBe("ru");
    expect(getPayPageCopy(null).lang).toBe("ru");
  });

  it.each([
    ["ru", "8 декабря 2026"],
    ["en", "December 8, 2026"],
    ["de", "8. Dezember 2026"],
    ["nl", "8 december 2026"],
  ] as const)("%s: formats the end date in the reader's language", (locale, expected) => {
    expect(formatPayDate("2026-12-08T10:00:00.000Z", locale)).toContain(expected);
  });

  it("fills tier and date", () => {
    expect(fillPayCopy("«{tier}» до {date}", { tier: "Мастер", date: "8 декабря" })).toBe("«Мастер» до 8 декабря");
  });
});

describe("pass reminder letter", () => {
  it.each(LOCALES)("%s: subject and button in the reader's language with the renew link", (locale) => {
    const letter = buildPassReminderEmail({
      locale,
      tier: "master",
      expiresAt: "2026-12-08T10:00:00.000Z",
      renewUrl: "https://harmonizer.zamkovoi.yoga/pay/renew?t=abc&x=1",
    });
    const copy = getPayPageCopy(locale);
    expect(letter.lang).toBe(locale);
    expect(letter.subject).not.toContain("{");
    expect(letter.html).not.toContain("{tier}");
    expect(letter.html).toContain(copy.reminderButton.replace(/&/g, "&amp;"));
    expect(letter.html).toContain(copy.tierMaster);
    expect(letter.html).toContain("https://harmonizer.zamkovoi.yoga/pay/renew?t=abc&amp;x=1");
    expect(letter.text).toContain("https://harmonizer.zamkovoi.yoga/pay/renew?t=abc&x=1");
  });
});

describe("yookassaFailureReason", () => {
  it("keeps who declined and why", () => {
    expect(yookassaFailureReason({ cancellation_details: { party: "issuer", reason: "3d_secure_failed" } })).toBe(
      "issuer:3d_secure_failed",
    );
    expect(yookassaFailureReason({ cancellation_details: { reason: "expired_on_confirmation" } })).toBe(
      "expired_on_confirmation",
    );
    expect(yookassaFailureReason({})).toBeNull();
  });
});
