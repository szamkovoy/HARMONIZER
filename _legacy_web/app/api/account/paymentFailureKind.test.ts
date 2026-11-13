import { describe, expect, it } from "vitest";

import { paymentFailureKind } from "./paymentFailureKind";

describe("paymentFailureKind", () => {
  it("treats a left form as abandoned", () => {
    expect(paymentFailureKind("Cancelled by customer")).toBe("abandoned");
    expect(paymentFailureKind("Cancelled by customer at checkout")).toBe("abandoned");
    expect(paymentFailureKind("yoo_money:expired_on_confirmation")).toBe("abandoned");
  });

  it("treats a 3-D Secure decline as declined_3ds", () => {
    expect(paymentFailureKind("Declined by 3-D Secure")).toBe("declined_3ds");
    expect(paymentFailureKind("payment_network:3d_secure_failed")).toBe("declined_3ds");
  });

  it("treats any other reason, including none, as declined", () => {
    expect(paymentFailureKind("payment_network:insufficient_funds")).toBe("declined");
    expect(paymentFailureKind(null)).toBe("declined");
  });
});
