import { createServiceSupabase, errorResponse, json } from "../../_utils/supabase";
import {
  applyMarketingDeliveryEvent,
  mapSesEventType,
} from "../../_utils/marketingDeliveryEvents";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Amazon SES → SNS → HTTPS events for marketing deliverability.
 * Match MessageId to email_*_sends.resend_id (provider message id).
 *
 * Ops: Configuration Set → SNS topic → HTTPS subscription to this URL
 * with `?token=<SES_MARKETING_WEBHOOK_SECRET>` (SNS cannot set Authorization).
 *
 * Enable: send, delivery, bounce, complaint (open/click optional — first-party preferred).
 */

function verifySesMarketingWebhook(req: Request): boolean {
  const secret = (process.env.SES_MARKETING_WEBHOOK_SECRET ?? "").trim();
  if (!secret) return false;
  const url = new URL(req.url);
  const q = url.searchParams.get("token")?.trim() ?? "";
  if (q && q === secret) return true;
  const auth = req.headers.get("authorization")?.trim() ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim() === secret;
  }
  return false;
}

type SnsEnvelope = {
  Type?: string;
  SubscribeURL?: string;
  Message?: string;
  MessageId?: string;
};

type SesEventBody = {
  eventType?: string;
  notificationType?: string;
  mail?: {
    messageId?: string;
    destination?: string[];
  };
  bounce?: {
    bounceType?: string;
    bouncedRecipients?: Array<{ emailAddress?: string }>;
  };
  complaint?: {
    complainedRecipients?: Array<{ emailAddress?: string }>;
  };
};

function extractRecipients(event: SesEventBody): string[] {
  const fromMail = (event.mail?.destination ?? [])
    .map((e) => e?.trim().toLowerCase())
    .filter(Boolean) as string[];
  if (fromMail.length) return fromMail;
  const bounced = (event.bounce?.bouncedRecipients ?? [])
    .map((r) => r.emailAddress?.trim().toLowerCase())
    .filter(Boolean) as string[];
  if (bounced.length) return bounced;
  return (event.complaint?.complainedRecipients ?? [])
    .map((r) => r.emailAddress?.trim().toLowerCase())
    .filter(Boolean) as string[];
}

export async function POST(req: Request) {
  try {
    if (!verifySesMarketingWebhook(req)) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    const rawBody = await req.text();
    let envelope: SnsEnvelope;
    try {
      envelope = JSON.parse(rawBody) as SnsEnvelope;
    } catch {
      return json({ error: "Invalid JSON" }, { status: 400 });
    }

    // SNS subscription handshake
    if (envelope.Type === "SubscriptionConfirmation" && envelope.SubscribeURL) {
      const confirm = await fetch(envelope.SubscribeURL);
      if (!confirm.ok) {
        return json(
          { error: `SNS confirm failed HTTP ${confirm.status}` },
          { status: 502 },
        );
      }
      return json({ ok: true, sns: "subscribed" });
    }

    if (envelope.Type === "UnsubscribeConfirmation") {
      return json({ ok: true, sns: "unsubscribe_ack" });
    }

    let event: SesEventBody;
    if (envelope.Type === "Notification" && typeof envelope.Message === "string") {
      try {
        event = JSON.parse(envelope.Message) as SesEventBody;
      } catch {
        return json({ error: "Invalid SNS Message JSON" }, { status: 400 });
      }
    } else {
      const direct = envelope as SnsEnvelope & SesEventBody;
      if (direct.eventType || direct.notificationType || direct.mail) {
        // Direct SES event (tests / EventBridge → HTTP without SNS wrap)
        event = direct;
      } else {
        return json({ ok: true, skipped: "unhandled_sns_type", type: envelope.Type });
      }
    }

    const messageId = event.mail?.messageId?.trim() ?? "";
    const mapped = mapSesEventType(event);
    if (!messageId && mapped.eventType === "email.unknown") {
      return json({ ok: true, skipped: "no_message_id" });
    }

    const db = createServiceSupabase();
    const result = await applyMarketingDeliveryEvent(db, {
      providerMessageId: messageId,
      mapped,
      recipients: extractRecipients(event),
      rawPayload: event,
      touchOpenClickTimestamps: true,
    });

    return json(result);
  } catch (error) {
    return errorResponse(error);
  }
}
