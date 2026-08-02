import { describe, expect, it } from "vitest";

import { getBreathPracticeById } from "@/modules/breath/core/practices";
import {
  buildShapeForTempo,
  canStepTriangleTempo,
  defaultTempoKey,
  formatTempoLabel,
  persistableTempoKey,
  resolveTempoKey,
  stepLinearTempoKey,
  stepTriangleTempoKey,
} from "@/modules/breath/core/breath-tempo";

describe("breath-tempo", () => {
  it("defaults: linear 6, square 4, triangles 4:4:4", () => {
    expect(defaultTempoKey("coherent")).toBe("6");
    expect(defaultTempoKey("nadi-shodhana")).toBe("6");
    expect(defaultTempoKey("square")).toBe("4");
    expect(defaultTempoKey("triangle-up")).toBe("4:4:4");
    expect(defaultTempoKey("triangle-down")).toBe("4:4:4");
  });

  it("persistableTempoKey clamps overlay singles onto the card list", () => {
    expect(persistableTempoKey("coherent", "15")).toBe("12");
    expect(persistableTempoKey("coherent", "1")).toBe("2");
    expect(persistableTempoKey("square", "4")).toBe("4");
  });

  it("triangle-down steps along the preset list", () => {
    expect(stepTriangleTempoKey("triangle-down", "5:10:10", 1)).toBe("5:20:10");
    expect(stepTriangleTempoKey("triangle-down", "5:10:10", -1)).toBe("5:10:5");
    expect(canStepTriangleTempo("triangle-down", "5:20:10", 1)).toBe(false);
    expect(canStepTriangleTempo("triangle-down", "3:3:3", -1)).toBe(false);
  });

  it("triangle-up builds inhale-exhale-hold phases from the preset", () => {
    const practice = getBreathPracticeById("triangle-up");
    const shape = buildShapeForTempo(practice, "4:8:16");
    expect(shape.phases.map((p) => [p.kind, p.beats])).toEqual([
      ["inhale", 4],
      ["exhale", 8],
      ["hold", 16],
    ]);
  });

  it("triangle-down builds inhale-hold-exhale phases from the preset", () => {
    const practice = getBreathPracticeById("triangle-down");
    const shape = buildShapeForTempo(practice, "5:10:5");
    expect(shape.phases.map((p) => [p.kind, p.beats])).toEqual([
      ["inhale", 5],
      ["hold", 10],
      ["exhale", 5],
    ]);
  });

  it("formatTempoLabel uses spaced colons for triples", () => {
    expect(formatTempoLabel("4:8:16")).toBe("4 : 8 : 16");
    expect(formatTempoLabel("6")).toBe("6");
  });

  it("resolveTempoKey rejects mismatched triangle keys", () => {
    expect(resolveTempoKey("triangle-up", "3:6:3")).toBe("4:4:4");
    expect(resolveTempoKey("triangle-down", "3:3:6")).toBe("4:4:4");
  });

  it("stepLinearTempoKey respects min/max", () => {
    expect(stepLinearTempoKey("1", -1)).toBe("1");
    expect(stepLinearTempoKey("60", 1)).toBe("60");
    expect(stepLinearTempoKey("12", 1)).toBe("13");
  });
});
