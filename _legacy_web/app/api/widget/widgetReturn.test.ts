import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { returnPageUrl, verifyWidgetReturn, widgetReturnUrl } from "./widgetReturn";

describe("widget return link", () => {
  const prev = process.env.ACCOUNT_CABINET_SECRET;

  beforeEach(() => {
    process.env.ACCOUNT_CABINET_SECRET = "test-secret";
  });

  afterEach(() => {
    process.env.ACCOUNT_CABINET_SECRET = prev;
  });

  it("round-trips a signed return with a page and without one", () => {
    const withPage = widgetReturnUrl({
      contractId: "c1",
      widgetId: "w1",
      pageUrl: "https://site.example/landing?utm=1#form",
    });
    expect(verifyWidgetReturn(new URL(withPage).searchParams)).toEqual({
      contractId: "c1",
      widgetId: "w1",
      pageUrl: "https://site.example/landing?utm=1",
    });

    const bare = widgetReturnUrl({ contractId: "c1", widgetId: "w1", pageUrl: null });
    expect(new URL(bare).searchParams.has("p")).toBe(false);
    expect(verifyWidgetReturn(new URL(bare).searchParams)).toEqual({
      contractId: "c1",
      widgetId: "w1",
      pageUrl: null,
    });
  });

  it("rejects a tampered contract, widget or page", () => {
    const url = widgetReturnUrl({
      contractId: "c1",
      widgetId: "w1",
      pageUrl: "https://site.example/landing",
    });
    for (const key of ["c", "w", "p"] as const) {
      const params = new URL(url).searchParams;
      params.set(key, `${params.get(key) ?? ""}x`);
      expect(verifyWidgetReturn(params)).toBeNull();
    }
  });
});

describe("returnPageUrl", () => {
  it("drops the hash, cuts a long query, and rejects a non-http page", () => {
    expect(returnPageUrl("https://site.example/landing?utm=1#form")).toBe("https://site.example/landing?utm=1");
    expect(returnPageUrl(`https://site.example/landing?q=${"x".repeat(1200)}#section`)).toBe(
      "https://site.example/landing",
    );
    expect(returnPageUrl(`https://site.example/${"a".repeat(1100)}`)).toBeNull();
    expect(returnPageUrl("javascript:alert(1)")).toBeNull();
    expect(returnPageUrl("ftp://site.example/a")).toBeNull();
    expect(returnPageUrl(null)).toBeNull();
  });
});
