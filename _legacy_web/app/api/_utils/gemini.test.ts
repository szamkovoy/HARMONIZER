import { describe, expect, it } from "vitest";

import { extractJson } from "./gemini";

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
