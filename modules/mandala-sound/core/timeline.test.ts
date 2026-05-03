import { describe, expect, it } from "vitest";

import { getMandalaSoundBand, getMandalaSoundTargetHz } from "@/modules/mandala-sound/core/timeline";

describe("mandala sound timeline", () => {
  it("moves long practices from beta toward delta", () => {
    const durationMs = 20 * 60_000;

    expect(getMandalaSoundBand(getMandalaSoundTargetHz(0, durationMs))).toBe("beta");
    expect(getMandalaSoundBand(getMandalaSoundTargetHz(durationMs * 0.3, durationMs))).toBe("alpha");
    expect(getMandalaSoundBand(getMandalaSoundTargetHz(durationMs * 0.75, durationMs))).toBe("theta");
    expect(getMandalaSoundBand(getMandalaSoundTargetHz(durationMs * 0.96, durationMs))).toBe("delta");
  });

  it("keeps short practices out of delta", () => {
    const durationMs = 3 * 60_000;
    const endHz = getMandalaSoundTargetHz(durationMs, durationMs);

    expect(endHz).toBeGreaterThanOrEqual(7);
    expect(getMandalaSoundBand(endHz)).toBe("theta");
  });
});
