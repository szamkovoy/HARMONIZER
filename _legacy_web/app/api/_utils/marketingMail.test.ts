import { describe, expect, it } from "vitest";

import { normalizeMarketingRecipient } from "./marketingMail";

describe("normalizeMarketingRecipient", () => {
  it("keeps a plain latin address", () => {
    expect(normalizeMarketingRecipient("  SESAM777@Yandex.RU ")).toEqual({
      ok: true,
      email: "sesam777@yandex.ru",
    });
  });

  it("drops invisible characters and a pasted display name", () => {
    expect(normalizeMarketingRecipient("Сезам <sesam777@yandex.ru>\u200b")).toEqual({
      ok: true,
      email: "sesam777@yandex.ru",
    });
  });

  it("folds cyrillic lookalikes into latin", () => {
    expect(normalizeMarketingRecipient("sesаm777@yаndex.ru")).toEqual({
      ok: true,
      email: "sesam777@yandex.ru",
    });
  });

  it("refuses an address that is still not latin", () => {
    const out = normalizeMarketingRecipient("пушкин@почта.рф");
    expect(out.ok).toBe(false);
  });
});
