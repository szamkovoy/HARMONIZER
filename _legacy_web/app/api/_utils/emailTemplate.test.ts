import { describe, expect, it } from "vitest";

import {
  applyEmailPlaceholders,
  bindUnsubscribeLinks,
  insertUrlSoftBreaks,
  normalizeEmailBodyHtml,
  softenEmailLinkBreaks,
  wrapEmailTextWithFontTag,
  wrapMarketingEmailHtml,
} from "./emailTemplate";

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
    expect(html).not.toContain("word-break:break-all");
    expect(html).toContain("a{word-break:normal;overflow-wrap:break-word;word-wrap:break-word;}");
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

  it("omits the unsubscribe footer when footer is null", () => {
    const html = wrapMarketingEmailHtml({
      bodyHtml: "<p>Спасибо за оплату.</p>",
      footer: null,
      lang: "ru",
    });
    expect(html).toContain("Спасибо за оплату.");
    expect(html).not.toContain("отписаться");
    expect(html).not.toContain("border-top:1px solid");
  });

  it("derives the preheader from the body, not the subject, so the inbox does not repeat the subject", () => {
    const html = wrapMarketingEmailHtml({
      bodyHtml: "<p>Здравствуйте, Дмитрий! Мы все так хотим быть услышанными.</p>",
      unsubscribeUrl: "https://example.com/u/unsubscribe?t=tok",
    });
    expect(html).toContain("Здравствуйте, Дмитрий! Мы все так хотим быть услышанными.");
    // Preheader is the body opening, present as the hidden snippet.
    expect(html).toMatch(/display:none[^>]*>Здравствуйте, Дмитрий/);
  });

  it("an explicit previewText still wins over the body opening", () => {
    const html = wrapMarketingEmailHtml({
      bodyHtml: "<p>Здравствуйте!</p>",
      previewText: "Сегодня — короткая практика на 5 минут",
      unsubscribeUrl: "https://example.com/u/unsubscribe?t=tok",
    });
    expect(html).toContain("Сегодня — короткая практика на 5 минут");
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

describe("softenEmailLinkBreaks", () => {
  it("keeps a URL that fits the column as one word and only hints breaks at URL boundaries", () => {
    const href = "https://zamkovoi.yoga/consult";
    const once = softenEmailLinkBreaks(
      `<p>запишитесь на консультацию - <a href="${href}">${href}</a></p>`,
    );
    const twice = softenEmailLinkBreaks(once);
    expect(twice).toBe(once);
    expect(once).toContain(`href="${href}"`);
    expect(once).not.toMatch(/href="[^"]*<wbr>/);
    expect(once).toContain("display:inline-block;max-width:100%");
    expect(once).toContain("word-break:normal");
    expect(once).not.toContain("word-break:break-all");
    expect(once).toContain("https://<wbr>zamkovoi<wbr>.yoga/<wbr>consult");
  });

  it("breaks a long URL only after :// and / and before . - _", () => {
    expect(insertUrlSoftBreaks("https://dzen.ru/video/watch/6af5199266b44f66455181ee")).toBe(
      "https://<wbr>dzen<wbr>.ru/<wbr>video/<wbr>watch/<wbr>6af5199266b44f66455181ee",
    );
    expect(insertUrlSoftBreaks("https://vkvideo.ru/video-230555637_456239162")).toBe(
      "https://<wbr>vkvideo<wbr>.ru/<wbr>video<wbr>-230555637<wbr>_456239162",
    );
    expect(insertUrlSoftBreaks("https://example.com/a?x=1&amp;y=2")).toBe(
      "https://<wbr>example<wbr>.com/<wbr>a<wbr>?x=<wbr>1&amp;<wbr>y=<wbr>2",
    );
    expect(insertUrlSoftBreaks("www.example.com/path")).toBe(
      "www<wbr>.example<wbr>.com/<wbr>path",
    );
  });

  it("does not atomize a descriptive link or a button", () => {
    const phrase = softenEmailLinkBreaks(
      `<p><a href="https://zamkovoi.yoga/wbr" style="color:#0f3d2e">Подробности и запись</a></p>`,
    );
    expect(phrase).toContain("color:#0f3d2e");
    expect(phrase).toContain("word-break:normal");
    expect(phrase).not.toContain("display:inline-block");
    expect(phrase).not.toContain("<wbr>");

    const button = `<a href="https://zamkovoi.yoga/consult" style="display:inline-block;background:#0f3d2e;color:#ffffff;">Записаться</a>`;
    expect(softenEmailLinkBreaks(button)).toBe(button);

    const image = `<a href="https://zamkovoi.yoga/consult" style="display:inline-block;"><img src="https://example.com/a.png" alt=""></a>`;
    expect(softenEmailLinkBreaks(image)).toBe(image);
  });

  it("wraps URL labels in the letter the preview and the inbox share", () => {
    const html = wrapMarketingEmailHtml({
      bodyHtml:
        '<p>консультацию - <a href="https://zamkovoi.yoga/consult">https://zamkovoi.yoga/consult</a></p>',
      unsubscribeUrl: "https://example.com/u/unsubscribe?t=verylongtoken",
    });
    expect(html).toContain("https://<wbr>zamkovoi<wbr>.yoga/<wbr>consult");
    expect(html).toContain("display:inline-block;max-width:100%");
    expect(html).toMatch(
      /<a href="https:\/\/example\.com\/u\/unsubscribe\?t=verylongtoken"[^>]*white-space:nowrap/,
    );
    expect(html).not.toContain("<wbr>отписаться");
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
