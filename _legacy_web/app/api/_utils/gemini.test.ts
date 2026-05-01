import { afterEach, describe, expect, it } from "vitest";
import { extractJson, getModelByHint } from "./gemini";

const originalStandard = process.env.AI_MODEL_STANDARD;
const originalPremium = process.env.AI_MODEL_PREMIUM;

afterEach(() => {
  process.env.AI_MODEL_STANDARD = originalStandard;
  process.env.AI_MODEL_PREMIUM = originalPremium;
});

describe("getModelByHint", () => {
  it("maps premium hint to premium environment tier", () => {
    process.env.AI_MODEL_STANDARD = "standard-model";
    process.env.AI_MODEL_PREMIUM = "premium-model";

    expect(getModelByHint("premium")).toBe("premium-model");
  });

  it("maps standard, null and unknown hints to standard tier", () => {
    process.env.AI_MODEL_STANDARD = "standard-model";
    process.env.AI_MODEL_PREMIUM = "premium-model";

    expect(getModelByHint("standard")).toBe("standard-model");
    expect(getModelByHint(null)).toBe("standard-model");
    expect(getModelByHint("legacy-model-name")).toBe("standard-model");
  });
});

describe("extractJson", () => {
  it("parses fenced JSON", () => {
    expect(extractJson('```json\n{"next_phase":"collect_state"}\n```')).toEqual({
      next_phase: "collect_state",
    });
  });

  it("extracts JSON from surrounding text", () => {
    expect(extractJson('Sure:\n{"deltas":{"Sun":{"dS":0,"dH":0}}}\nDone')).toEqual({
      deltas: { Sun: { dS: 0, dH: 0 } },
    });
  });

  it("repairs common trailing and missing comma issues", () => {
    expect(extractJson('{"next_phase":"offer_insight" "should_close":false,}')).toEqual({
      next_phase: "offer_insight",
      should_close: false,
    });
  });
});
