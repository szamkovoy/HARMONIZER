import { describe, expect, it } from "vitest";

import { isRetryableOtpPermitError } from "./otpPermitRetry";

describe("isRetryableOtpPermitError", () => {
  it("retries gateway stalls and aborted fetches", () => {
    expect(isRetryableOtpPermitError({ message: "Gateway Timeout" })).toBe(true);
    expect(isRetryableOtpPermitError({ message: "The operation was aborted due to timeout" })).toBe(
      true,
    );
    expect(isRetryableOtpPermitError({ message: "TypeError: fetch failed" })).toBe(true);
    expect(isRetryableOtpPermitError({ code: "504", message: "" })).toBe(true);
  });

  it("does not retry a definitive database answer", () => {
    expect(isRetryableOtpPermitError(null)).toBe(false);
    expect(isRetryableOtpPermitError({ message: "invalid_email" })).toBe(false);
    expect(isRetryableOtpPermitError({ message: "permission denied for function" })).toBe(false);
  });
});
