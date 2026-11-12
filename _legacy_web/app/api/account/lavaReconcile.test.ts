import { describe, expect, it } from "vitest";

import { lavaInvoiceDecision, lavaReconcileDue } from "./lavaReconcile";

describe("lavaInvoiceDecision", () => {
  it("fulfills a completed Lava invoice", () => {
    expect(lavaInvoiceDecision("COMPLETED")).toBe("fulfill");
    expect(lavaInvoiceDecision("success")).toBe("fulfill");
  });

  it("checks a hanging invoice once or twice, then stops", () => {
    const created = Date.parse("2026-11-06T20:02:16.000Z");
    expect(lavaReconcileDue(created, created + 9 * 60 * 1000)).toBe(false);
    expect(lavaReconcileDue(created, created + 10 * 60 * 1000)).toBe(true);
    expect(lavaReconcileDue(created, created + 20 * 60 * 1000)).toBe(true);
    expect(lavaReconcileDue(created, created + 23 * 60 * 1000)).toBe(false);
  });

  it("fails a declined invoice and waits on an open checkout", () => {
    expect(lavaInvoiceDecision("FAILED")).toBe("fail");
    expect(lavaInvoiceDecision("IN_PROGRESS")).toBe("wait");
    expect(lavaInvoiceDecision("NEW")).toBe("wait");
    expect(lavaInvoiceDecision(null)).toBe("wait");
  });
});
