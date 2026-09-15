import { createHash } from "crypto";
import { afterEach, describe, expect, it } from "vitest";

import { ALL_CONTENT_LOCALES } from "./contentLocales";
import {
  parseUnsubscribeParam,
  signUnsubscribeToken,
  generateUnsubscribeToken,
  buildSignedUnsubscribeUrl,
} from "./emailUnsubscribe";
import { getUnsubscribePageCopy } from "./emailUnsubscribeCopy";

describe("unsubscribe tokens", () => {
  const prevSecret = process.env.EMAIL_UNSUBSCRIBE_SECRET;
  const prevBase = process.env.EMAIL_PUBLIC_BASE_URL;

  afterEach(() => {
    if (prevSecret == null) delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
    else process.env.EMAIL_UNSUBSCRIBE_SECRET = prevSecret;
    if (prevBase == null) delete process.env.EMAIL_PUBLIC_BASE_URL;
    else process.env.EMAIL_PUBLIC_BASE_URL = prevBase;
  });

  it("round-trips HMAC and rejects a bad signature", () => {
    process.env.EMAIL_UNSUBSCRIBE_SECRET = "test-unsub-secret";
    const token = generateUnsubscribeToken();
    const signed = signUnsubscribeToken(token);
    expect(signed).toContain(".");
    expect(parseUnsubscribeParam(signed)).toBe(token);
    expect(parseUnsubscribeParam(`${token}.deadbeefdeadbeefdeadbeefdeadbeef`)).toBeNull();
    expect(parseUnsubscribeParam(token)).toBe(token);
  });

  it("accepts legacy sha256(secret:token) signatures", () => {
    process.env.EMAIL_UNSUBSCRIBE_SECRET = "test-unsub-secret";
    const token = "a".repeat(48);
    const legacy = createHash("sha256")
      .update(`test-unsub-secret:${token}`)
      .digest("hex")
      .slice(0, 32);
    expect(parseUnsubscribeParam(`${token}.${legacy}`)).toBe(token);
  });

  it("builds a public /unsubscribe URL and accepts t or token", () => {
    process.env.EMAIL_UNSUBSCRIBE_SECRET = "";
    process.env.EMAIL_PUBLIC_BASE_URL = "https://zamkovoi.yoga";
    const token = "b".repeat(48);
    expect(buildSignedUnsubscribeUrl(token)).toBe(
      `https://zamkovoi.yoga/unsubscribe?t=${token}`,
    );
    expect(parseUnsubscribeParam(token)).toBe(token);
  });
});

describe("unsubscribe page copy", () => {
  it("covers all 8 content locales", () => {
    for (const locale of ALL_CONTENT_LOCALES) {
      const copy = getUnsubscribePageCopy(locale);
      expect(copy.lang).toBe(locale);
      expect(copy.successTitle.trim()).not.toBe("");
      expect(copy.successBody.trim()).not.toBe("");
      expect(copy.invalidTitle.trim()).not.toBe("");
    }
  });
});
