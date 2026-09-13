import { describe, expect, it } from "vitest";

import { isTimeoutError, toUserFacingStreamErrorMessage } from "./monitoring";

describe("isTimeoutError", () => {
  it("matches Vercel/Sentry Gateway Timeout", () => {
    expect(isTimeoutError(new Error("Gateway Timeout"))).toBe(true);
  });

  it("matches LLM and abort timeouts", () => {
    expect(isTimeoutError(new Error("Gemini request timed out after 30000ms"))).toBe(true);
    expect(isTimeoutError(new Error("The operation was aborted"))).toBe(true);
  });

  it("does not match ordinary 5xx copy", () => {
    expect(isTimeoutError(new Error("Internal server error"))).toBe(false);
  });
});

describe("toUserFacingStreamErrorMessage", () => {
  it("asks the user to retry on Gateway Timeout", () => {
    expect(toUserFacingStreamErrorMessage(new Error("Gateway Timeout"))).toMatch(/ещё раз/i);
  });
});
