import {
  addResendSuppression,
  removeResendSuppression,
} from "../../_utils/resendMarketingApi";
import { applyMarketingDeliveryEvent } from "../../_utils/marketingDeliveryEvents";
import { createServiceSupabase, errorResponse, json } from "../../_utils/supabase";
import {
  extractRecipientEmails,
  isOtpTransportResendEvent,
  mapResendEventType,
  verifyResendMarketingWebhook,
  type ResendWebhookPayload,
} from "../../_utils/resendWebhook";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Resend marketing webhooks → email_events + campaign counters + auto-suppress.
 * OTP (zamkovoi.yoga / sign-in codes) is ignored — same Resend account can emit them.
 *
 * Enable: sent, delivered, delivery_delayed, opened, clicked, bounced, complained,
 * failed, suppressed, suppression.added, suppression.removed.
 */
export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    if (!verifyResendMarketingWebhook(req, rawBody)) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }

    let payload: ResendWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as ResendWebhookPayload;
    } catch {
      return json({ error: "Invalid JSON" }, { status: 400 });
    }

    const type = payload.type?.trim() ?? "";
    if (!type) {
      return json({ ok: true, skipped: "missing type" });
    }

    // Account-level Resend webhook also fires for OTP on zamkovoi.yoga.
    if (isOtpTransportResendEvent(payload)) {
      return json({ ok: true, skipped: "otp_transport" });
    }

    const resendId = payload.data?.email_id?.trim() ?? "";
    const mapped = mapResendEventType(type, payload);
    const db = createServiceSupabase();
    const recipients = extractRecipientEmails(payload);

    const result = await applyMarketingDeliveryEvent(db, {
      providerMessageId: resendId,
      mapped: {
        eventType: mapped.eventType,
        sendStatus: mapped.sendStatus,
        campaignCounter: mapped.campaignCounter,
        suppressStatus: mapped.suppressStatus,
        isHardBounce: mapped.isHardBounce,
        addToResendSuppressions: mapped.addToResendSuppressions,
        removeFromResendSuppressions: mapped.removeFromResendSuppressions,
      },
      recipients,
      rawPayload: payload,
      touchOpenClickTimestamps: true,
    });

    if (result.duplicate) {
      return json({ ok: true, duplicate: true });
    }

    // Mirror hard bounce / complaint to Resend suppression list (Resend transport only).
    if (mapped.addToResendSuppressions && recipients.length) {
      for (const email of recipients) {
        await addResendSuppression(email);
      }
    }
    if (mapped.removeFromResendSuppressions && recipients.length) {
      for (const email of recipients) {
        await removeResendSuppression(email);
      }
    }

    return json({
      ok: true,
      hard_bounce: result.hard_bounce,
      suppressed_local: result.suppressed_local,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
