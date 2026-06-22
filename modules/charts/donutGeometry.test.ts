import { describe, expect, it } from "vitest";

import { donutPath } from "./donutGeometry";

describe("donutGeometry", () => {
  it("renders a full donut ring for a single 360-degree segment", () => {
    const path = donutPath(82, 82, 72, 48, 0, 360);

    expect(path).toContain("A 72 72 0 1 1");
    expect(path).toContain("A 48 48 0 1 0");
    expect(path.match(/A 72 72/g)).toHaveLength(2);
    expect(path.match(/A 48 48/g)).toHaveLength(2);
  });
});
