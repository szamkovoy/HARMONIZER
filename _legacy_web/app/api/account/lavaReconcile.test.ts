import { describe, expect, it } from "vitest";

import {
  findMissedLavaRenewal,
  lavaInvoiceDecision,
  lavaReconcileDue,
  lavaRenewalCandidate,
  lavaSubscriptionTerminallyFailed,
} from "./lavaReconcile";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

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

describe("lavaRenewalCandidate", () => {
  it("is due while the paid period has passed", () => {
    const end = Date.parse("2026-11-10T00:42:06.000Z");
    expect(lavaRenewalCandidate(end, end - HOUR)).toBe(false); // период ещё идёт
    expect(lavaRenewalCandidate(end, end)).toBe(true);
    expect(lavaRenewalCandidate(end, end + 72 * HOUR)).toBe(true);
  });

  it("stops asking after the reconcile window", () => {
    const end = Date.parse("2026-10-01T00:00:00.000Z");
    expect(lavaRenewalCandidate(end, end + 29 * DAY)).toBe(true);
    expect(lavaRenewalCandidate(end, end + 31 * DAY)).toBe(false);
  });

  it("never fires without a period end", () => {
    expect(lavaRenewalCandidate(null, Date.now())).toBe(false);
    expect(lavaRenewalCandidate(NaN, Date.now())).toBe(false);
  });
});

describe("findMissedLavaRenewal", () => {
  const periodEnd = Date.parse("2026-11-09T16:32:00.000Z");

  it("finds a completed charge after the period end (lost renewal webhook)", () => {
    const missed = findMissedLavaRenewal(
      [
        { id: "b", datetime: "2026-11-09T16:32:06.200Z", status: "COMPLETED", amount: 99, currency: "EUR" },
        { id: "a", datetime: "2026-10-09T16:32:54.110Z", status: "COMPLETED", amount: 99, currency: "EUR" },
      ],
      periodEnd,
    );
    expect(missed?.id).toBe("b");
  });

  it("ignores failed charges and older completed ones", () => {
    expect(
      findMissedLavaRenewal(
        [
          { id: "f", datetime: "2026-11-10T00:42:05.000Z", status: "FAILED" },
          { id: "a", datetime: "2026-10-09T16:32:54.110Z", status: "COMPLETED" },
        ],
        periodEnd,
      ),
    ).toBeNull();
  });

  it("tolerates a charge landing shortly before the period end", () => {
    const missed = findMissedLavaRenewal(
      [{ id: "early", datetime: "2026-11-09T13:00:00.000Z", status: "COMPLETED" }],
      periodEnd,
    );
    expect(missed?.id).toBe("early");
  });

  it("picks the newest completed charge among several", () => {
    const missed = findMissedLavaRenewal(
      [
        { id: "first", datetime: "2026-11-09T16:40:00.000Z", status: "COMPLETED" },
        { id: "second", datetime: "2026-12-09T16:41:00.000Z", status: "COMPLETED" },
      ],
      periodEnd,
    );
    expect(missed?.id).toBe("second");
  });

  it("skips unparsable rows", () => {
    expect(
      findMissedLavaRenewal([{ id: "bad", datetime: "not-a-date", status: "COMPLETED" }], periodEnd),
    ).toBeNull();
    expect(findMissedLavaRenewal([], periodEnd)).toBeNull();
  });
});

describe("lavaSubscriptionTerminallyFailed", () => {
  it("only FAILED is terminal", () => {
    expect(lavaSubscriptionTerminallyFailed("FAILED")).toBe(true);
    expect(lavaSubscriptionTerminallyFailed(" failed ")).toBe(true);
    expect(lavaSubscriptionTerminallyFailed("ACTIVE")).toBe(false);
    expect(lavaSubscriptionTerminallyFailed(null)).toBe(false);
    expect(lavaSubscriptionTerminallyFailed(undefined)).toBe(false);
  });
});
