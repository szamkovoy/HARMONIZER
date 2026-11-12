import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { classifyUnsuccessful, isLapsedFailureReason } from "../admin/_utils/unsuccessfulPayments";
import { RECONCILE_FAILED_REASON } from "./lavaReconcile";
import { buildPaymentAlertLetter, claimPaymentAlert, formatAlertMoscowTime } from "./paymentAlerts";
import { logPaymentEvent } from "./paymentEvents";
import { buildRenewalFailedEmail } from "./renewalFailedNotice";
import { formatPayDate, getPayPageCopy } from "./payPageCopy";

const LOCALES = ["ru", "en", "de", "fr", "it", "es", "pt", "nl"] as const;
const ACCESS_UNTIL = "2026-12-01T00:00:00.000Z";
const RENEW_URL = "https://harmonizer.zamkovoi.yoga/pay/renew?t=abc";

function insertDb(error: { code?: string; message?: string } | null): SupabaseClient {
  return {
    from() {
      return { insert: async () => ({ error }) };
    },
  } as unknown as SupabaseClient;
}

describe("unsuccessful payment classification", () => {
  const now = new Date("2026-11-13T12:00:00.000Z");

  it("keeps failed, renewal/lapsed cancels, and pending older than 30 minutes", () => {
    expect(isLapsedFailureReason("renewal: Bank's malfunction")).toBe(true);
    expect(isLapsedFailureReason("lapsed: no renewal")).toBe(true);
    expect(isLapsedFailureReason("Declined by 3-D Secure")).toBe(false);
    expect(classifyUnsuccessful({ status: "failed", created_at: now.toISOString() }, now)).toBe("failed");
    expect(
      classifyUnsuccessful(
        { status: "cancelled", failure_reason: "renewal: canceled", created_at: now.toISOString() },
        now,
      ),
    ).toBe("lapsed");
    expect(
      classifyUnsuccessful(
        { status: "cancelled", failure_reason: "user cancelled", created_at: now.toISOString() },
        now,
      ),
    ).toBe(null);
    const fresh = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
    const stale = new Date(now.getTime() - 31 * 60 * 1000).toISOString();
    expect(classifyUnsuccessful({ status: "pending", created_at: fresh }, now)).toBe(null);
    expect(classifyUnsuccessful({ status: "pending", created_at: stale }, now)).toBe("pending");
  });
});

describe("payment alert letter", () => {
  it("includes Moscow time, the admin profile link, and the raw payload", () => {
    const at = new Date("2026-11-12T21:00:00.000Z");
    expect(formatAlertMoscowTime(at)).toBe("13.11.2026 00:00");
    const letter = buildPaymentAlertLetter({
      eventType: "payment.failed",
      contractId: "e5167608-c022-4e2b-8bf4-88b03bd970dc",
      userId: "user-1",
      buyerEmail: "a@b.c",
      tier: "oracle",
      productKind: "subscription",
      amount: 950,
      currency: "RUB",
      provider: "lavatop",
      failureReason: "renewal: Bank's malfunction",
      raw: { status: "subscription-failed" },
      at,
    });
    expect(letter.text).toContain("13.11.2026 00:00");
    expect(letter.text).toContain("/admin/users/user-1");
    expect(letter.text).toContain("950 RUB");
    expect(letter.text).toContain("subscription-failed");
    expect(letter.html).toContain("subscription-failed");
  });
});

describe("renewal failed buyer letter", () => {
  it("names the access date and the renew link in every locale", () => {
    const subjects = new Set<string>();
    for (const locale of LOCALES) {
      const letter = buildRenewalFailedEmail({
        locale,
        tier: "oracle",
        accessUntil: ACCESS_UNTIL,
        renewUrl: RENEW_URL,
      });
      const copy = getPayPageCopy(locale);
      expect(letter.lang).toBe(copy.lang);
      expect(letter.subject).toBe(copy.renewalFailedSubject);
      expect(letter.html).toContain(formatPayDate(ACCESS_UNTIL, copy.lang));
      expect(letter.html).toContain(RENEW_URL.replace(/&/g, "&amp;"));
      expect(letter.text).toContain(RENEW_URL);
      subjects.add(letter.subject);
    }
    expect(subjects.size).toBe(LOCALES.length);
  });
});

describe("payment journal and alert claim", () => {
  it("swallows a database error while writing the journal", async () => {
    const db = {
      from() {
        throw new Error("database down");
      },
    } as unknown as SupabaseClient;
    await expect(logPaymentEvent(db, { provider: "lavatop", eventType: "payment.failed" })).resolves.toBeUndefined();
  });

  it("claims the first alert and skips a duplicate", async () => {
    await expect(claimPaymentAlert(insertDb(null), "c1", "payment.failed")).resolves.toBe(true);
    await expect(
      claimPaymentAlert(insertDb({ code: "23505", message: "duplicate" }), "c1", "payment.failed"),
    ).resolves.toBe(false);
    await expect(claimPaymentAlert(insertDb(null), null, "checkout.create_failed")).resolves.toBe(true);
  });

  it("uses the reconcile failure reason", () => {
    expect(RECONCILE_FAILED_REASON).toBe("reconcile: invoice FAILED");
  });
});
