import { describe, expect, it } from "vitest";

import { getPayPageCopy, payTierName } from "./payPageCopy";
import {
  buildPaymentFailedEmail,
  groupFailedNoticeCandidates,
  shouldSendFailedNotice,
  type FailedNoticeFacts,
} from "./paymentFailedNotices";

const OPEN: FailedNoticeFacts = {
  failureReason: "Declined by 3-D Secure",
  laterPaidAccess: false,
  hasPaidTier: false,
  noticeSentWithin24h: false,
};

const LOCALES = ["ru", "en", "de", "fr", "it", "es", "pt", "nl"] as const;

describe("shouldSendFailedNotice", () => {
  it("sends when nothing was paid after the failure", () => {
    expect(shouldSendFailedNotice(OPEN)).toBe(true);
  });

  it("does not send when a later access contract is already active", () => {
    expect(shouldSendFailedNotice({ ...OPEN, laterPaidAccess: true })).toBe(false);
  });

  it("does not send when the user already has a paid tier", () => {
    expect(shouldSendFailedNotice({ ...OPEN, hasPaidTier: true })).toBe(false);
  });

  it("does not send a second letter within 24 hours", () => {
    expect(shouldSendFailedNotice({ ...OPEN, noticeSentWithin24h: true })).toBe(false);
  });

  it("does not send when the buyer cancelled", () => {
    expect(shouldSendFailedNotice({ ...OPEN, failureReason: "Cancelled by customer" })).toBe(false);
    expect(shouldSendFailedNotice({ ...OPEN, failureReason: "Cancelled by customer at checkout" })).toBe(false);
  });

  it("does not send when the YooKassa form expired without a charge", () => {
    expect(shouldSendFailedNotice({ ...OPEN, failureReason: "yoo_money:expired_on_confirmation" })).toBe(false);
  });
});

describe("groupFailedNoticeCandidates", () => {
  it("keeps the newest failure per user and suppresses the rest", () => {
    const groups = groupFailedNoticeCandidates([
      { userId: "a", contractId: "old", updatedAt: "2026-11-13T10:00:00.000Z" },
      { userId: "a", contractId: "new", updatedAt: "2026-11-13T12:00:00.000Z" },
      { userId: "b", contractId: "only", updatedAt: "2026-11-13T11:00:00.000Z" },
    ]);
    expect(groups.map((group) => group.send.contractId)).toEqual(["new", "only"]);
    expect(groups[0].suppress.map((row) => row.contractId)).toEqual(["old"]);
    expect(groups[1].suppress).toEqual([]);
  });
});

describe("buildPaymentFailedEmail", () => {
  it("names the tier and the pay link in every locale", () => {
    const url = "https://harmonizer.zamkovoi.yoga/pay/failed?t=abc";
    const subjects = new Set<string>();
    for (const locale of LOCALES) {
      const letter = buildPaymentFailedEmail({ locale, tier: "oracle", payUrl: url });
      const copy = getPayPageCopy(locale);
      expect(letter.subject).toContain(payTierName(copy, "oracle"));
      expect(letter.html).toContain(url);
      expect(letter.text).toContain(url);
      subjects.add(letter.subject);
    }
    expect(subjects.size).toBe(LOCALES.length);
  });
});
