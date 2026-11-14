import { describe, expect, it } from "vitest";

import { buildPayLetterBody } from "./payLetter";
import { getPayPageCopy } from "./payPageCopy";

describe("buildPayLetterBody", () => {
  it("puts the button in a spaced paragraph and the signature on two lines after it", () => {
    const copy = getPayPageCopy("en");
    const url = "https://harmonizer.zamkovoi.yoga/pay/failed?t=abc&c=1";
    const { bodyHtml, text } = buildPayLetterBody({
      copy,
      text: "Hello!\n\nThe payment did not go through.",
      buttonLabel: "Choose how to pay",
      buttonUrl: url,
      buttonColor: "#2E8B57",
    });
    const button = '<p style="margin:28px 0;">';
    const signature = "<p>All the best,<br />Sergei Zamkovoi</p>";
    expect(bodyHtml).toContain(button);
    expect(bodyHtml.indexOf(signature)).toBeGreaterThan(bodyHtml.indexOf(button));
    const letterAt = text.indexOf("Hello!");
    const linkAt = text.indexOf(url);
    const signAt = text.indexOf("All the best,");
    expect(letterAt).toBeGreaterThanOrEqual(0);
    expect(letterAt).toBeLessThan(linkAt);
    expect(linkAt).toBeLessThan(signAt);
    expect(text).toContain("Sergei Zamkovoi");
  });
});
