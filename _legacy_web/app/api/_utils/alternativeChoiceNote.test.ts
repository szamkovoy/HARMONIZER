import { describe, expect, it } from "vitest";
import { alternativeChoiceMathReason, alternativeChoiceNote } from "./alternativeChoiceNote";

describe("alternativeChoiceNote", () => {
  it("returns the authoring Russian sentence by default and a translated sentence for other locales", () => {
    expect(alternativeChoiceNote(null)).toMatch(/другую тему/);
    expect(alternativeChoiceNote("de")).toMatch(/anderes Thema/);
    expect(alternativeChoiceNote("fr-FR")).toMatch(/autre thème/);
    expect(alternativeChoiceNote("xx")).toMatch(/другую тему/);
  });

  it("keeps the math reason in the same locale", () => {
    expect(alternativeChoiceMathReason("en")).toMatch(/two previous days/);
    expect(alternativeChoiceMathReason("nl")).toMatch(/twee vorige dagen/);
  });
});
