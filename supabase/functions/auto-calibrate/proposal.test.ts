import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isPendingProposal, isRejectedRecently } from "./proposal";

describe("isPendingProposal", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns false for null/undefined", () => {
    expect(isPendingProposal(null)).toBe(false);
    expect(isPendingProposal(undefined)).toBe(false);
  });

  it("returns false for non-pending status", () => {
    expect(isPendingProposal({ status: "accepted", expiresAt: "2099-01-01T00:00:00Z" })).toBe(false);
    expect(isPendingProposal({ status: "rejected" })).toBe(false);
    expect(isPendingProposal({ status: "expired" })).toBe(false);
  });

  it("uses expiresAt when available", () => {
    vi.setSystemTime(new Date("2026-04-29T00:00:00Z"));

    expect(isPendingProposal({ status: "pending", expiresAt: "2026-05-01T00:00:00Z" })).toBe(true);
    expect(isPendingProposal({ status: "pending", expiresAt: "2026-04-28T00:00:00Z" })).toBe(false);
  });

  it("falls back to createdAt + 30 days when expiresAt missing", () => {
    vi.setSystemTime(new Date("2026-04-29T00:00:00Z"));

    expect(isPendingProposal({ status: "pending", createdAt: "2026-04-19T00:00:00Z" })).toBe(true);

    expect(isPendingProposal({ status: "pending", createdAt: "2026-03-19T00:00:00Z" })).toBe(false);
  });

  it("falls back to suggestedAt + 30 days when expiresAt and createdAt missing", () => {
    vi.setSystemTime(new Date("2026-04-29T00:00:00Z"));
    expect(isPendingProposal({ status: "pending", suggestedAt: "2026-04-19T00:00:00Z" })).toBe(true);
    expect(isPendingProposal({ status: "pending", suggestedAt: "2026-03-19T00:00:00Z" })).toBe(false);
  });

  it("returns false for proposal without expiresAt and createdAt", () => {
    expect(isPendingProposal({ status: "pending" } as { status: string })).toBe(false);
  });
});

describe("isRejectedRecently", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("returns true within 30 days of rejection", () => {
    vi.setSystemTime(new Date("2026-04-29T00:00:00Z"));
    expect(
      isRejectedRecently({
        status: "rejected",
        respondedAt: "2026-04-15T00:00:00Z",
      }),
    ).toBe(true);
  });

  it("returns false after 30 days", () => {
    vi.setSystemTime(new Date("2026-04-29T00:00:00Z"));
    expect(
      isRejectedRecently({
        status: "rejected",
        respondedAt: "2026-03-15T00:00:00Z",
      }),
    ).toBe(false);
  });

  it("uses createdAt when respondedAt is missing", () => {
    vi.setSystemTime(new Date("2026-04-29T00:00:00Z"));
    expect(isRejectedRecently({ status: "rejected", createdAt: "2026-04-20T00:00:00Z" })).toBe(true);
    expect(isRejectedRecently({ status: "rejected", createdAt: "2026-03-01T00:00:00Z" })).toBe(false);
  });
});
