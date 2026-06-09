import { describe, expect, it } from "vitest";

import {
  chakraDisplayLabelRu,
  chakraLabelAccusativeRu,
  chakraLabelGenitiveRu,
  chakraLabelRu,
  chakraNumberFromRuLabel,
} from "./labels";

describe("chakra labels", () => {
  it("maps chakra numbers to russian ordinal labels", () => {
    expect(chakraLabelRu(1)).toBe("первая чакра");
    expect(chakraLabelRu(7)).toBe("седьмая чакра");
    expect(chakraLabelAccusativeRu(7)).toBe("седьмую чакру");
    expect(chakraLabelGenitiveRu(5)).toBe("пятой чакры");
  });

  it("resolves legacy sanskrit labels to chakra numbers", () => {
    expect(chakraNumberFromRuLabel("Муладхара")).toBe(1);
    expect(chakraNumberFromRuLabel("Вишуддха")).toBe(5);
    expect(chakraNumberFromRuLabel("седьмая чакра")).toBe(7);
  });

  it("normalizes visible russian labels away from sanskrit", () => {
    expect(chakraDisplayLabelRu("Сахасрара")).toBe("седьмая чакра");
    expect(chakraDisplayLabelRu(4)).toBe("четвёртая чакра");
  });
});
