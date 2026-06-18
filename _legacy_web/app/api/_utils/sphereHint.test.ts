import { describe, expect, it } from "vitest";

import {
  buildSphereBalanceLensForPrompt,
  buildSphereHint,
  buildSphereStats,
} from "./sphereHint";

describe("sphereHint", () => {
  it("builds Day-tab hint and a compact dialog lens from the same stats", () => {
    const stats = buildSphereStats([
      { cells: [{ sphere: 3, weight: 1 }] },
    ], "it");
    const hint = buildSphereHint(stats, "it");
    const lens = buildSphereBalanceLensForPrompt(stats, "it");
    expect(hint).toMatch(/denaro\/impegni/i);
    expect(lens).toMatch(/Sphere balance:/i);
    expect(lens).toMatch(/barely present:/i);
    expect(lens).not.toBe(hint);
  });

  it("returns null lens when the plan is already broad", () => {
    const stats = buildSphereStats([
      { cells: [{ sphere: 1, weight: 0.2 }] },
      { cells: [{ sphere: 2, weight: 0.2 }] },
      { cells: [{ sphere: 3, weight: 0.2 }] },
      { cells: [{ sphere: 4, weight: 0.2 }] },
      { cells: [{ sphere: 5, weight: 0.2 }] },
    ], "en");
    expect(buildSphereHint(stats, "en")).toBeNull();
    expect(buildSphereBalanceLensForPrompt(stats, "en")).toBeNull();
  });
});
