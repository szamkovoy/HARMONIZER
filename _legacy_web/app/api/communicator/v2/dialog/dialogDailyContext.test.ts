import { describe, expect, it } from "vitest";

import { DIALOG_MATRIX_LOOKBACK_DAYS } from "./dialogDailyContext";

describe("DIALOG_MATRIX_LOOKBACK_DAYS", () => {
  it("caps matrix load so dialog load_context cannot fetch unbounded daily_matrices", () => {
    expect(DIALOG_MATRIX_LOOKBACK_DAYS).toBe(7);
  });
});
