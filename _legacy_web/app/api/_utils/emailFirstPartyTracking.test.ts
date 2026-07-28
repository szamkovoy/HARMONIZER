import { describe, expect, it } from "vitest";

import {
  injectFirstPartyEmailTracking,
  parseEmailTrackToken,
  rewriteEmailAssetUrlsForCache,
  safeClickRedirectUrl,
  signEmailTrackToken,
} from "./emailFirstPartyTracking";

describe("injectFirstPartyEmailTracking", () => {
  it("adds open pixel and wraps http links, skips unsubscribe", () => {
    const html = `<!DOCTYPE html><html><body>
<a href="https://example.com/a">A</a>
<a href="https://zamkovoi.yoga/unsubscribe/email?t=x">U</a>
</body></html>`;
    const out = injectFirstPartyEmailTracking(html, "11111111-1111-4111-8111-111111111111");
    expect(out).toContain("/api/email/track/open?t=");
    expect(out).toContain("/api/email/track/click?t=");
    expect(out).toContain(encodeURIComponent("https://example.com/a"));
    expect(out).toContain("/unsubscribe/email?t=x");
    expect(out).not.toMatch(
      /track\/click[^"]*unsubscribe/i,
    );
  });

  it("rewrites supabase email-assets through cacheable proxy", () => {
    const src =
      "https://vsdmphhczmcgfrvbwodp.supabase.co/storage/v1/object/public/email-assets/campaigns/x.png";
    const out = rewriteEmailAssetUrlsForCache(
      `<img src="${src}" />`,
      "https://harmonizer-ten.vercel.app",
    );
    expect(out).toContain("/api/email/asset?u=");
    expect(out).toContain(encodeURIComponent(src));
  });
});

describe("track token", () => {
  it("round-trips uuid without secret", () => {
    const id = "22222222-2222-4222-8222-222222222222";
    process.env.EMAIL_TRACKING_SECRET = "";
    process.env.EMAIL_UNSUBSCRIBE_SECRET = "";
    expect(parseEmailTrackToken(signEmailTrackToken(id))).toBe(id);
  });
});

describe("safeClickRedirectUrl", () => {
  it("allows https and rejects javascript", () => {
    expect(safeClickRedirectUrl("https://a.example/x")).toBe("https://a.example/x");
    expect(safeClickRedirectUrl("javascript:alert(1)")).toBeNull();
  });
});
