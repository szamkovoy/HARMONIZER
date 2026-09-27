import { describe, expect, it } from "vitest";

import {
  emailOpenTrackingDisabled,
  injectFirstPartyEmailTracking,
  parseEmailTrackToken,
  rewriteEmailAssetUrlsForCache,
  safeClickRedirectUrl,
  signEmailTrackToken,
} from "./emailFirstPartyTracking";

describe("injectFirstPartyEmailTracking", () => {
  it("adds open pixel and wraps http links, skips unsubscribe", () => {
    delete process.env.DISABLE_EMAIL_OPEN_TRACKING;
    const html = `<!DOCTYPE html><html><body>
<a href="https://example.com/a">A</a>
<a href="https://zamkovoi.yoga/unsubscribe/email?t=x">U</a>
<a href="https://zamkovoi.yoga/unsubscribe?t=y">U2</a>
<a href="https://zamkovoi.yoga/api/unsubscribe?token=z">U3</a>
</body></html>`;
    const out = injectFirstPartyEmailTracking(html, "11111111-1111-4111-8111-111111111111");
    expect(out).toContain("/api/email/track/open?t=");
    expect(out).toContain("/api/email/track/click?t=");
    expect(out).toContain(encodeURIComponent("https://example.com/a"));
    expect(out).toContain("/unsubscribe/email?t=x");
    expect(out).toContain("/unsubscribe?t=y");
    expect(out).toContain("/api/unsubscribe?token=z");
    expect(out).not.toMatch(
      /track\/click[^"]*unsubscribe/i,
    );
  });

  it("omits the open pixel when DISABLE_EMAIL_OPEN_TRACKING is set, and still wraps clicks", () => {
    const prev = process.env.DISABLE_EMAIL_OPEN_TRACKING;
    process.env.DISABLE_EMAIL_OPEN_TRACKING = "true";
    try {
      expect(emailOpenTrackingDisabled()).toBe(true);
      const out = injectFirstPartyEmailTracking(
        `<body><a href="https://example.com/a">A</a></body>`,
        "11111111-1111-4111-8111-111111111111",
      );
      expect(out).not.toContain("/api/email/track/open");
      expect(out).toContain("/api/email/track/click?t=");
      expect(out).toContain(encodeURIComponent("https://example.com/a"));
    } finally {
      if (prev === undefined) delete process.env.DISABLE_EMAIL_OPEN_TRACKING;
      else process.env.DISABLE_EMAIL_OPEN_TRACKING = prev;
    }
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

  it("points Blob files at the public /email-cdn path", () => {
    const src = "https://abc123.public.blob.vercel-storage.com/email-assets/campaigns/x.jpg";
    const out = rewriteEmailAssetUrlsForCache(`<img src="${src}" />`, "https://harmonizer.zamkovoi.yoga");
    expect(out).toContain(
      "https://harmonizer.zamkovoi.yoga/email-cdn/email-assets/campaigns/x.jpg",
    );
    expect(out).not.toContain("blob.vercel-storage.com");
    expect(out).not.toContain("/api/email/asset");
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
