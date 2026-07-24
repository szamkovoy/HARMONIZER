import { createHmac, timingSafeEqual } from "crypto";

function safeEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/**
 * Verify Resend webhook (Svix) or Bearer shared secret.
 * Secret: RESEND_MARKETING_WEBHOOK_SECRET (whsec_… or plain bearer).
 */
export function verifyResendMarketingWebhook(
  req: Request,
  rawBody: string,
): boolean {
  const secret = (process.env.RESEND_MARKETING_WEBHOOK_SECRET ?? "").trim();
  if (!secret) return false;

  const auth = req.headers.get("authorization")?.trim() ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token && safeEqual(token, secret)) return true;
  }

  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  const ageSec = Math.abs(Date.now() / 1000 - Number(svixTimestamp));
  if (!Number.isFinite(ageSec) || ageSec > 60 * 5) return false;

  const key = secret.startsWith("whsec_")
    ? Buffer.from(secret.slice(6), "base64")
    : Buffer.from(secret, "utf8");

  const toSign = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expected = createHmac("sha256", key).update(toSign).digest("base64");

  for (const part of svixSignature.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    if (safeEqual(sig, expected)) return true;
  }
  return false;
}

export type ResendWebhookPayload = {
  type?: string;
  data?: {
    email_id?: string;
    created_at?: string;
    to?: string[];
    click?: { link?: string };
    bounce?: { message?: string };
  };
};

/** Map Resend event type → our send status / counters. */
export function mapResendEventType(type: string): {
  eventType: string;
  sendStatus: string | null;
  campaignCounter: string | null;
  suppressStatus: "suppressed" | "complained" | null;
} {
  switch (type) {
    case "email.sent":
      return { eventType: type, sendStatus: "sent", campaignCounter: null, suppressStatus: null };
    case "email.delivered":
      return {
        eventType: type,
        sendStatus: "delivered",
        campaignCounter: "delivered_count",
        suppressStatus: null,
      };
    case "email.opened":
      return {
        eventType: type,
        sendStatus: "opened",
        campaignCounter: "opened_count",
        suppressStatus: null,
      };
    case "email.clicked":
      return {
        eventType: type,
        sendStatus: "clicked",
        campaignCounter: "clicked_count",
        suppressStatus: null,
      };
    case "email.bounced":
      return {
        eventType: type,
        sendStatus: "bounced",
        campaignCounter: "bounced_count",
        suppressStatus: "suppressed",
      };
    case "email.complained":
      return {
        eventType: type,
        sendStatus: "complained",
        campaignCounter: "complained_count",
        suppressStatus: "complained",
      };
    case "email.delivery_delayed":
      return { eventType: type, sendStatus: null, campaignCounter: null, suppressStatus: null };
    default:
      return { eventType: type, sendStatus: null, campaignCounter: null, suppressStatus: null };
  }
}
