import { describe, expect, it } from "vitest";

import { normalizeEmailBodyHtml, wrapMarketingEmailHtml } from "./emailTemplate";

describe("normalizeEmailBodyHtml", () => {
  it("zeros margins on non-empty paragraphs", () => {
    const out = normalizeEmailBodyHtml("<p>Hello</p><p>World</p>");
    expect(out).toContain('style="margin:0;padding:0;"');
    expect(out).not.toMatch(/margin:\s*1em/i);
  });

  it("turns empty paragraphs into one-line spacers", () => {
    const out = normalizeEmailBodyHtml("<p>A</p><p><br></p><p>B</p>");
    expect(out).toContain("height:1.55em");
    expect(out).toContain("&nbsp;");
  });

  it("keeps soft breaks without inventing block gaps", () => {
    const out = normalizeEmailBodyHtml("<p>Line one<br>Line two</p>");
    expect(out).toContain("<br>");
    expect(out.match(/height:1\.55em/g)).toBeNull();
  });
});

describe("wrapMarketingEmailHtml", () => {
  it("uses 560px column and normalized body", () => {
    const html = wrapMarketingEmailHtml({
      bodyHtml: "<p>Hi</p><p><br></p><p>There</p>",
      unsubscribeUrl: "https://example.com/u",
    });
    expect(html).toContain("max-width:560px");
    expect(html).toContain("height:1.55em");
    expect(html).toContain("https://example.com/u");
  });
});
