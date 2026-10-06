import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendMarketingEmailBatch, type MarketingBatchItem } from "./marketingMail";
import { compactDeliveryPayload } from "./marketingDeliveryEvents";

const item = (n: number, to = `user${n}@example.com`): MarketingBatchItem => ({
  key: `send-${n}`,
  to,
  subject: `Subject ${n}`,
  html: `<p>${n}</p>`,
  text: `${n}`,
  unsubscribeUrl: `https://x.test/u/${n}`,
  locale: "ru",
});

describe("sendMarketingEmailBatch (Resend /emails/batch)", () => {
  const env = { ...process.env };
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.EMAIL_MARKETING = "RESEND_ZAMKOVOI_RU";
    process.env.RESEND_ZAMKOVOI_RU_API_KEY = "re_test";
    process.env.EMAIL_MARKETING_FROM_EMAIL = "hello@zamkovoi.ru";
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...env };
  });

  it("maps ids back in input order and keeps invalid recipients local", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: "r-1" }, { id: "r-3" }] }), { status: 200 }),
    );
    const res = await sendMarketingEmailBatch([item(1), item(2, "not-an-email"), item(3)], {
      idempotencyKey: "batch-abc",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.results[0]).toEqual({ ok: true, resendId: "r-1" });
    expect(res.results[1]?.ok).toBe(false);
    expect(res.results[2]).toEqual({ ok: true, resendId: "r-3" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails/batch");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("batch-abc");
    const body = JSON.parse((init as RequestInit).body as string) as Record<string, unknown>[];
    expect(body).toHaveLength(2);
    expect(body[0]).not.toHaveProperty("tags");
    expect((body[0]!.headers as Record<string, string>)["List-Unsubscribe"]).toBe(
      "<https://x.test/u/1>",
    );
  });

  it("429 → nothing sent, rows may be re-queued", async () => {
    fetchMock.mockResolvedValueOnce(new Response("rate limited", { status: 429 }));
    const res = await sendMarketingEmailBatch([item(1)], { idempotencyKey: "k" });
    expect(res).toMatchObject({ ok: false, sent: false, rateLimited: true });
  });

  it("network failure → outcome unknown, rows must stay claimed", async () => {
    fetchMock.mockRejectedValueOnce(new Error("socket hang up"));
    const res = await sendMarketingEmailBatch([item(1)], { idempotencyKey: "k" });
    expect(res).toMatchObject({ ok: false, sent: "unknown" });
  });

  it("id count mismatch → unknown (never guess which letter went out)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ id: "only-one" }] }), { status: 200 }),
    );
    const res = await sendMarketingEmailBatch([item(1), item(2)], { idempotencyKey: "k" });
    expect(res).toMatchObject({ ok: false, sent: "unknown" });
  });

  it("refuses more than 100 letters", async () => {
    const many = Array.from({ length: 101 }, (_, i) => item(i));
    const res = await sendMarketingEmailBatch(many, { idempotencyKey: "k" });
    expect(res).toMatchObject({ ok: false, sent: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("compactDeliveryPayload", () => {
  it("keeps bounce reason and first recipient, drops headers/subject/html", () => {
    const raw = {
      type: "email.bounced",
      created_at: "2026-10-05T16:00:00Z",
      data: {
        email_id: "abc",
        from: "hello@zamkovoi.ru",
        to: ["a@example.com", "b@example.com"],
        subject: "Big subject",
        headers: [{ name: "List-Unsubscribe", value: "<...>" }],
        bounce: { type: "Permanent", subType: "General", message: "mailbox does not exist" },
      },
    };
    expect(compactDeliveryPayload(raw)).toEqual({
      type: "email.bounced",
      created_at: "2026-10-05T16:00:00Z",
      data: {
        to: ["a@example.com"],
        bounce: { type: "Permanent", subType: "General", message: "mailbox does not exist" },
      },
    });
  });

  it("maps SES bounce shape", () => {
    const raw = {
      eventType: "Bounce",
      mail: { destination: ["c@example.com"] },
      bounce: { bounceType: "Permanent", bounceSubType: "Suppressed" },
    };
    expect(compactDeliveryPayload(raw)).toEqual({
      type: "Bounce",
      data: { to: ["c@example.com"], bounce: { type: "Permanent", subType: "Suppressed" } },
    });
  });
});
