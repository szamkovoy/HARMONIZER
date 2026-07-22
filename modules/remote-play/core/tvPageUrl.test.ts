import { describe, expect, it } from "vitest";

import { TV_PAGE_BASE_URL, tvPageUrl } from "@/modules/remote-play/core/tvPageUrl";

describe("tvPageUrl", () => {
  it("uses the short bare URL for Russian", () => {
    expect(tvPageUrl("ru")).toBe("https://zamkovoi.yoga/tv");
    expect(TV_PAGE_BASE_URL).toBe("https://zamkovoi.yoga/tv");
  });

  it("uses compact ?<locale> for every other content locale", () => {
    expect(tvPageUrl("pt")).toBe("https://zamkovoi.yoga/tv?pt");
    expect(tvPageUrl("en")).toBe("https://zamkovoi.yoga/tv?en");
    expect(tvPageUrl("de")).toBe("https://zamkovoi.yoga/tv?de");
  });
});
