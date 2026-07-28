import { describe, expect, it } from "vitest";

import { sanitizeEmailRichHtml, sanitizeInlineStyle } from "./emailRichHtml";

describe("sanitizeInlineStyle", () => {
  it("drops Apple/Word font longhands and default color", () => {
    const style =
      'font-style: normal; font-variant: normal; font-size-adjust: none; font-kerning: auto; font-stretch: normal; font-size: 13px; line-height: normal; font-family: "Helvetica Neue"; color: rgb(0, 0, 0)';
    expect(sanitizeInlineStyle(style)).toBe("");
  });

  it("keeps bold/italic/underline/color", () => {
    expect(
      sanitizeInlineStyle("font-weight: 700; font-style: italic; text-decoration: underline; color: #0f3d2e"),
    ).toBe("font-weight:700;font-style:italic;text-decoration:underline;color:#0f3d2e");
  });
});

describe("sanitizeEmailRichHtml", () => {
  it("strips class and paste style bloat while keeping text and emphasis", () => {
    const input =
      '<p class="p1" style="font-style: normal; font-variant: normal; font-size-adjust: none; font-language-override: normal; font-kerning: auto; font-optical-sizing: auto; font-feature-settings: normal; font-variation-settings: normal; font-stretch: normal; font-size: 13px; line-height: normal; font-family: &quot;Helvetica Neue&quot;; color: rgb(0, 0, 0);">Здравствуйте, {{name}}!</p><p class="p2" style="font-size: 13px; font-family: Helvetica Neue; min-height: 15px; color: rgb(0, 0, 0);"><br></p><p class="p1" style="font-size: 13px; color: rgb(0, 0, 0);">Текст с <i>курсивом</i> и <b>жирным</b>.</p>';
    const out = sanitizeEmailRichHtml(input);
    expect(out).toContain("Здравствуйте, {{name}}!");
    expect(out).toContain("<i>курсивом</i>");
    expect(out).toContain("<b>жирным</b>");
    expect(out).not.toContain("class=");
    expect(out).not.toContain("Helvetica");
    expect(out).not.toContain("font-size-adjust");
    expect(out).not.toContain("min-height");
    expect(out.length).toBeLessThan(input.length / 2);
  });

  it("keeps anchor href", () => {
    const out = sanitizeEmailRichHtml(
      '<p><a href="https://example.com" class="x" style="font-family: Arial; color: #0f3d2e">link</a></p>',
    );
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain("color:#0f3d2e");
    expect(out).not.toContain("class=");
    expect(out).not.toContain("Arial");
  });
});
