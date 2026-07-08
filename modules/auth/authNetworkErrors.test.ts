import { describe, expect, it } from "vitest";

import { isInvalidRefreshTokenError } from "./authNetworkErrors";

describe("isInvalidRefreshTokenError", () => {
  it("detects invalid refresh message", () => {
    expect(
      isInvalidRefreshTokenError(new Error("Invalid Refresh Token: Refresh Token Not Found")),
    ).toBe(true);
  });

  it("detects refresh_token_not_found code", () => {
    expect(isInvalidRefreshTokenError({ status: 400, code: "refresh_token_not_found", message: "x" })).toBe(
      true,
    );
  });

  it("ignores transient network failures", () => {
    expect(isInvalidRefreshTokenError(new TypeError("Network request failed"))).toBe(false);
  });
});
