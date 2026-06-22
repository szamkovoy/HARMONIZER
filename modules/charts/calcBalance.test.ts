import { describe, expect, it } from "vitest";

import { calcBalance } from "./calcBalance";

describe("calcBalance", () => {
  it("anchors the extremes at near-zero and one hundred percent", () => {
    expect(calcBalance([1, 0, 0, 0, 0, 0, 0])).toEqual({ balance: 1, angle: 3.6 });
    expect(calcBalance([1, 1, 1, 1, 1, 1, 1])).toEqual({ balance: 100, angle: 360 });
  });

  it("rewards broader distribution but still penalizes visible unevenness", () => {
    expect(calcBalance([1, 1, 0, 0, 0, 0, 0])).toEqual({ balance: 19, angle: expect.closeTo(68.4, 5) });
    expect(calcBalance([1, 1, 1, 1, 1, 1, 0])).toEqual({ balance: 75, angle: 270 });
    expect(calcBalance([20, 18, 17, 14, 11, 9, 7])).toEqual({ balance: 79, angle: expect.closeTo(284.4, 5) });
    expect(calcBalance([30, 18, 16, 10, 8, 11, 7])).toEqual({ balance: 68, angle: expect.closeTo(244.8, 5) });
  });

  it("treats uneven two-segment distributions as much less balanced than the equal split", () => {
    expect(calcBalance([13.47, 3, 0, 0, 0, 0, 0])).toEqual({ balance: 7, angle: expect.closeTo(25.2, 5) });
    expect(calcBalance([13.47, 3, 0, 0, 0, 0, 0]).balance).toBeLessThan(calcBalance([1, 1, 0, 0, 0, 0, 0]).balance);
  });

  it("stays noticeably below perfect when one segment is missing", () => {
    expect(calcBalance([1, 1, 1, 1, 1, 1, 0])).not.toEqual({ balance: 100, angle: 360 });
    expect(calcBalance([1, 1, 1, 1, 1, 1, 1])).toEqual({ balance: 100, angle: 360 });
  });

  it("handles empty totals", () => {
    expect(calcBalance([0, 0, 0, 0, 0, 0, 0])).toEqual({ balance: 0, angle: 0 });
  });
});
