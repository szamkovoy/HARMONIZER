import { describe, expect, it } from "vitest";
import { buildAddressFormHint } from "./addressForm";

describe("buildAddressFormHint", () => {
  it("returns Russian informal and formal hints", () => {
    expect(buildAddressFormHint("informal", "ru")).toBe("ты");
    expect(buildAddressFormHint("formal", "ru-RU")).toBe("вы");
  });

  it("falls back to formal Russian and neutral English", () => {
    expect(buildAddressFormHint(null, "ru")).toBe("вы");
    expect(buildAddressFormHint("informal", "en")).toBe("you");
  });
});
