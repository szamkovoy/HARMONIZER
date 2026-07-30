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
  created_at?: string;
  data?: {
    email_id?: string;
    created_at?: string;
    from?: string;
    to?: string[];
    subject?: string;
    click?: { link?: string; userAgent?: string; ipAddress?: string };
    bounce?: {
      message?: string;
      type?: string | null;
      subType?: string | null;
      diagnosticCode?: string[];
    };
    failed?: { reason?: string };
    suppressed?: {
      message?: string;
      reason?: string;
      type?: string;
      diagnosticCode?: string[];
    };
    /** suppression.added / suppression.removed */
    email?: string;
    id?: string;
    origin?: string;
  };
};

export type MappedResendEvent = {
  eventType: string;
  sendStatus: string | null;
  campaignCounter: string | null;
  /** Local contact marketing_status to set (only active → this). */
  suppressStatus: "suppressed" | "complained" | "active" | null;
  /** Mirror to Resend /suppressions API. */
  addToResendSuppressions: boolean;
  removeFromResendSuppressions: boolean;
  /** Hard bounce only — soft/transient does not suppress. */
  isHardBounce: boolean;
};

function bounceIsHard(payload: ResendWebhookPayload): boolean {
  const t = (payload.data?.bounce?.type ?? "").toLowerCase();
  if (t === "permanent") return true;
  if (t === "transient") return false;
  // Unknown type: treat as hard (safer for reputation).
  return true;
}

/** MailboxFull is Transient at Gmail but marketing should stop (OTP unaffected). */
function bounceShouldSuppressMarketing(payload: ResendWebhookPayload): boolean {
  if (bounceIsHard(payload)) return true;
  const sub = (payload.data?.bounce?.subType ?? "").toLowerCase();
  return sub === "mailboxfull";
}

/**
 * Resend account webhooks can include OTP (zamkovoi.yoga). Those must not pollute
 * marketing deliverability / suppressions.
 */
export function isOtpTransportResendEvent(payload: ResendWebhookPayload): boolean {
  const from = (payload.data?.from ?? "").toLowerCase();
  if (from.includes("@zamkovoi.yoga")) return true;
  const subject = (payload.data?.subject ?? "").toLowerCase();
  if (subject.includes("sign-in code") || subject.includes("код входа")) return true;
  return false;
}

/** Map Resend event type → our send status / counters / suppress actions. */
export function mapResendEventType(
  type: string,
  payload?: ResendWebhookPayload,
): MappedResendEvent {
  switch (type) {
    case "email.sent":
      return {
        eventType: type,
        sendStatus: "sent",
        campaignCounter: null,
        suppressStatus: null,
        addToResendSuppressions: false,
        removeFromResendSuppressions: false,
        isHardBounce: false,
      };
    case "email.delivered":
      return {
        eventType: type,
        sendStatus: "delivered",
        campaignCounter: "delivered_count",
        suppressStatus: null,
        addToResendSuppressions: false,
        removeFromResendSuppressions: false,
        isHardBounce: false,
      };
    case "email.opened":
      return {
        eventType: type,
        sendStatus: "opened",
        campaignCounter: "opened_count",
        suppressStatus: null,
        addToResendSuppressions: false,
        removeFromResendSuppressions: false,
        isHardBounce: false,
      };
    case "email.clicked":
      return {
        eventType: type,
        sendStatus: "clicked",
        campaignCounter: "clicked_count",
        suppressStatus: null,
        addToResendSuppressions: false,
        removeFromResendSuppressions: false,
        isHardBounce: false,
      };
    case "email.bounced": {
      const hard = bounceIsHard(payload ?? {});
      const suppress = bounceShouldSuppressMarketing(payload ?? {});
      return {
        eventType: type,
        sendStatus: "bounced",
        campaignCounter: "bounced_count",
        suppressStatus: suppress ? "suppressed" : null,
        addToResendSuppressions: suppress,
        removeFromResendSuppressions: false,
        isHardBounce: hard,
      };
    }
    case "email.complained":
      return {
        eventType: type,
        sendStatus: "complained",
        campaignCounter: "complained_count",
        suppressStatus: "complained",
        addToResendSuppressions: true,
        removeFromResendSuppressions: false,
        isHardBounce: false,
      };
    case "email.delivery_delayed":
      return {
        eventType: type,
        sendStatus: null,
        campaignCounter: null,
        suppressStatus: null,
        addToResendSuppressions: false,
        removeFromResendSuppressions: false,
        isHardBounce: false,
      };
    case "email.failed":
      return {
        eventType: type,
        sendStatus: "failed",
        campaignCounter: null,
        suppressStatus: null,
        addToResendSuppressions: false,
        removeFromResendSuppressions: false,
        isHardBounce: false,
      };
    case "email.suppressed":
      return {
        eventType: type,
        sendStatus: "skipped",
        campaignCounter: null,
        suppressStatus: "suppressed",
        addToResendSuppressions: false,
        removeFromResendSuppressions: false,
        isHardBounce: false,
      };
    case "suppression.added":
      return {
        eventType: type,
        sendStatus: null,
        campaignCounter: null,
        suppressStatus: "suppressed",
        addToResendSuppressions: false,
        removeFromResendSuppressions: false,
        isHardBounce: false,
      };
    case "suppression.removed":
      return {
        eventType: type,
        sendStatus: null,
        campaignCounter: null,
        suppressStatus: "active",
        addToResendSuppressions: false,
        removeFromResendSuppressions: false,
        isHardBounce: false,
      };
    default:
      return {
        eventType: type,
        sendStatus: null,
        campaignCounter: null,
        suppressStatus: null,
        addToResendSuppressions: false,
        removeFromResendSuppressions: false,
        isHardBounce: false,
      };
  }
}

export function extractRecipientEmails(payload: ResendWebhookPayload): string[] {
  const fromData = payload.data?.to;
  if (Array.isArray(fromData) && fromData.length) {
    return fromData.map((e) => String(e).trim().toLowerCase()).filter(Boolean);
  }
  const single = payload.data?.email?.trim().toLowerCase();
  return single ? [single] : [];
}
