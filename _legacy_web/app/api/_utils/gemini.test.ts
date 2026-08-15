import { afterEach, describe, expect, it } from "vitest";
import { extractJson, getModelAttemptChainForTest, getModelByHint } from "./gemini";

const originalStandard = process.env.AI_MODEL_STANDARD;
const originalPremium = process.env.AI_MODEL_PREMIUM;
const originalFallback = process.env.AI_MODEL_FALLBACK;
const originalLow = process.env.AI_MODEL_LOW;

afterEach(() => {
  process.env.AI_MODEL_STANDARD = originalStandard;
  process.env.AI_MODEL_PREMIUM = originalPremium;
  process.env.AI_MODEL_FALLBACK = originalFallback;
  process.env.AI_MODEL_LOW = originalLow;
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

  it("uses AI_MODEL_LOW for low-cost hint and falls back to standard", () => {
    process.env.AI_MODEL_STANDARD = "standard-model";
    process.env.AI_MODEL_LOW = "low-model";
    expect(getModelByHint("low")).toBe("low-model");
    delete process.env.AI_MODEL_LOW;
    expect(getModelByHint("low")).toBe("standard-model");
  });

  it("accepts concrete Gemini model hints", () => {
    expect(getModelByHint("gemini-2.5-flash")).toBe("gemini-2.5-flash");
  });

  it("normalizes informal Gemini 3.1 marketing ids to API preview model ids", () => {
    process.env.AI_MODEL_STANDARD = "gemini-3.1-flash";
    process.env.AI_MODEL_PREMIUM = "gemini-3.1-pro";

    expect(getModelByHint("standard")).toBe("gemini-3-flash-preview");
    expect(getModelByHint("premium")).toBe("gemini-3.1-pro-preview");
    expect(getModelByHint("gemini-3.1-flash")).toBe("gemini-3-flash-preview");
    expect(getModelByHint("gemini-3.1-pro")).toBe("gemini-3.1-pro-preview");
  });

  it("maps standard and premium fallback hints to FALLBACK env vars", () => {
    process.env.AI_MODEL_STANDARD = "gemini-3.1-flash";
    process.env.AI_MODEL_PREMIUM = "gemini-3.1-pro";
    process.env.AI_MODEL_FALLBACK = "gemini-2.5-flash";
    expect(getModelByHint("standard", { fallback: true })).toBe("gemini-2.5-flash");
    expect(getModelByHint("premium", { fallback: true })).toBe("gemini-2.5-flash");
  });

  it("does not rewrite legacy 1.5 ids unless ALLOW_LEGACY_GEMINI_MODELS=true", () => {
    const prev = process.env.ALLOW_LEGACY_GEMINI_MODELS;
    process.env.AI_MODEL_STANDARD = "gemini-1.5-flash";
    process.env.AI_MODEL_PREMIUM = "premium-model";
    delete process.env.ALLOW_LEGACY_GEMINI_MODELS;
    expect(getModelByHint("standard")).toBe("gemini-1.5-flash");
    process.env.ALLOW_LEGACY_GEMINI_MODELS = "true";
    expect(getModelByHint("standard")).toBe("gemini-2.5-flash");
    if (prev === undefined) delete process.env.ALLOW_LEGACY_GEMINI_MODELS;
    else process.env.ALLOW_LEGACY_GEMINI_MODELS = prev;
  });
});

describe("getModelAttemptChainForTest", () => {
  it("keeps premium requests on premium before fallback", () => {
    process.env.AI_MODEL_STANDARD = "standard-model";
    process.env.AI_MODEL_PREMIUM = "premium-model";
    process.env.AI_MODEL_FALLBACK = "fallback-model";

    expect(getModelAttemptChainForTest("premium-model")).toEqual(["premium-model", "fallback-model"]);
  });

  it("keeps standard requests on standard before fallback", () => {
    process.env.AI_MODEL_STANDARD = "standard-model";
    process.env.AI_MODEL_PREMIUM = "premium-model";
    process.env.AI_MODEL_FALLBACK = "fallback-model";

    expect(getModelAttemptChainForTest("standard-model")).toEqual(["standard-model", "fallback-model"]);
  });

  it("can disable env fallback for admin playground", () => {
    process.env.AI_MODEL_STANDARD = "standard-model";
    process.env.AI_MODEL_FALLBACK = "fallback-model";

    expect(getModelAttemptChainForTest("standard-model", undefined, { disableEnvFallback: true })).toEqual([
      "standard-model",
    ]);
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
