import { describe, expect, it } from "vitest";

import { thanksReturnUrl } from "./widgetServer";

describe("thanksReturnUrl", () => {
  it("adds hz_paid and drops the hash", () => {
    expect(thanksReturnUrl("https://site.ru/landing?utm=1#form", "w1")).toBe("https://site.ru/landing?utm=1&hz_paid=w1");
  });

  it("rejects non-http pages", () => {
    expect(thanksReturnUrl("javascript:alert(1)", "w1")).toBeNull();
    expect(thanksReturnUrl(null, "w1")).toBeNull();
  });
});
