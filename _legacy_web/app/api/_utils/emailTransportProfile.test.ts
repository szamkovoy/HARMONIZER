import { describe, expect, it } from "vitest";

import {
  parseEmailTransportProfile,
  resolveMarketingTransportProfile,
  resolveOtpTransportProfile,
} from "./emailTransportProfile";

describe("emailTransportProfile", () => {
  it("parses four profiles", () => {
    expect(parseEmailTransportProfile("amazon_zamkovoi_yoga", "EMAIL_OTP").id).toBe(
      "AMAZON_ZAMKOVOI_YOGA",
    );
    expect(parseEmailTransportProfile("RESEND_ZAMKOVOI_RU", "EMAIL_MARKETING").provider).toBe(
      "resend",
    );
  });

  it("OTP falls back from AUTH_EMAIL_PROVIDER", () => {
    expect(resolveOtpTransportProfile({ AUTH_EMAIL_PROVIDER: "ses" }).id).toBe(
      "AMAZON_ZAMKOVOI_YOGA",
    );
    expect(resolveOtpTransportProfile({ AUTH_EMAIL_PROVIDER: "resend" }).id).toBe(
      "RESEND_ZAMKOVOI_YOGA",
    );
    expect(
      resolveOtpTransportProfile({
        EMAIL_OTP: "RESEND_ZAMKOVOI_RU",
        AUTH_EMAIL_PROVIDER: "ses",
      }).id,
    ).toBe("RESEND_ZAMKOVOI_RU");
  });

  it("marketing defaults to Resend ru", () => {
    expect(resolveMarketingTransportProfile({}).id).toBe("RESEND_ZAMKOVOI_RU");
    expect(resolveMarketingTransportProfile({ EMAIL_MARKETING: "AMAZON_ZAMKOVOI_RU" }).id).toBe(
      "AMAZON_ZAMKOVOI_RU",
    );
  });
});
