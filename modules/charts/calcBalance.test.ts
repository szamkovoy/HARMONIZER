import { describe, expect, it } from "vitest";

import { calcBalance } from "./calcBalance";

describe("calcBalance", () => {
  it("matches reference examples", () => {
    expect(calcBalance([1, 0, 0, 0, 0, 0, 0])).toEqual({ balance: 14, angle: expect.closeTo(50.4, 5) });
    expect(calcBalance([1, 1, 0, 0, 0, 0, 0])).toEqual({ balance: 29, angle: expect.closeTo(104.4, 5) });
    expect(calcBalance([3, 1, 0, 0, 0, 0, 0])).toEqual({ balance: 14, angle: expect.closeTo(50.4, 5) });
    expect(calcBalance([1, 1, 1, 1, 1, 1, 0])).toEqual({ balance: 86, angle: expect.closeTo(309.6, 5) });
    expect(calcBalance([1, 1, 1, 1, 1, 1, 1])).toEqual({ balance: 100, angle: 360 });
  });

  it("handles empty totals", () => {
    expect(calcBalance([0, 0, 0, 0, 0, 0, 0])).toEqual({ balance: 0, angle: 0 });
  });
});
