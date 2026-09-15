import { describe, expect, it } from "vitest";

import { bindUnsubscribeLinks, normalizeEmailBodyHtml, wrapEmailTextWithFontTag, wrapMarketingEmailHtml, applyEmailPlaceholders } from "./emailTemplate";

describe("normalizeEmailBodyHtml", () => {
  it("zeros margins and sets an explicit 16px font on paragraphs", () => {
    const out = normalizeEmailBodyHtml("<p>Hello</p><p>World</p>");
    expect(out).toContain("margin:0;padding:0;");
    expect(out).toContain("font-size:16px !important");
    expect(out).toContain("font-family:Arial,Helvetica,sans-serif");
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

describe("wrapEmailTextWithFontTag", () => {
  it("keeps paragraphs and duplicates 16px onto a font tag", () => {
    const out = wrapEmailTextWithFontTag(
      '<p style="margin:0;font-size:16px !important;font-family:Arial,Helvetica,sans-serif;">Hello</p>',
    );
    expect(out).toMatch(/<p[\s>]/i);
    expect(out).toContain('size="3"');
    expect(out).toContain("font-size:16px");
    expect(out).toContain("Hello");
  });
});

describe("wrapMarketingEmailHtml", () => {
  it("centers a 560px column with 16px body and does not inflate the canvas", () => {
    const html = wrapMarketingEmailHtml({
      bodyHtml: "<p>Hi</p><p><br></p><p>There</p>",
      unsubscribeUrl: "https://example.com/u/unsubscribe?t=verylongtoken",
      previewText: "Как не утонуть в информационных потоках",
    });
    expect(html).toContain("max-width:560px");
    expect(html).toContain("table-layout:fixed");
    expect(html).toContain("word-break:break-word");
    expect(html).toContain("overflow-wrap:anywhere");
    expect(html).toContain("-webkit-text-size-adjust:none");
    expect(html).toContain("max-width:0");
    expect(html).not.toContain("<!--[if mso]>");
    expect(html).not.toContain("min-width:100%");
    expect(html).toContain('align="center"');
    expect(html).toContain("font-size:16px");
    expect(html).not.toContain("font-size:24px");
    expect(html).toMatch(
      /<a href="https:\/\/example\.com\/u\/unsubscribe\?t=verylongtoken"[^>]*white-space:nowrap/,
    );
    expect(html).not.toMatch(
      /<a href="https:\/\/example\.com\/u\/unsubscribe\?t=verylongtoken"[^>]*word-break:break-all/,
    );
  });
});

describe("bindUnsubscribeLinks", () => {
  it("replaces {{unsubscribe_url}} and Отписаться buttons", () => {
    const url = "https://zamkovoi.yoga/unsubscribe?t=abc";
    const html = bindUnsubscribeLinks(
      `<p><a href="{{unsubscribe_url}}">link</a></p>
       <a href="https://" style="color:#fff">Отписаться</a>
       <a href="https://example.com/course">Перейти</a>`,
      url,
    );
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain("Отписаться");
    expect(html).toContain("https://example.com/course");
    expect(html.match(new RegExp(url.replace(/[?]/g, "\\?"), "g"))?.length).toBeGreaterThanOrEqual(2);
  });

  it("does not rewrite ordinary CTAs", () => {
    const html = bindUnsubscribeLinks(
      `<a href="https://zamkovoi.yoga/cabinet">Личный кабинет</a>`,
      "https://zamkovoi.yoga/unsubscribe?t=abc",
    );
    expect(html).toContain("https://zamkovoi.yoga/cabinet");
    expect(html).not.toContain("/unsubscribe?t=abc");
  });
});

describe("applyEmailPlaceholders", () => {
  it("fills name and unsubscribe url", () => {
    const out = applyEmailPlaceholders("Здравствуйте, {{name}}! {{unsubscribe_url}}", {
      name: "Анна",
      unsubscribeUrl: "https://zamkovoi.yoga/unsubscribe?t=x",
    });
    expect(out).toContain("Анна");
    expect(out).toContain("https://zamkovoi.yoga/unsubscribe?t=x");
  });
});
