import { createServiceSupabase, errorResponse, json } from "../../_utils/supabase";
import {
  mapResendEventType,
  verifyResendMarketingWebhook,
  type ResendWebhookPayload,
} from "../../_utils/resendWebhook";

export const runtime = "nodejs";

/**
 * Resend marketing webhooks → email_events + campaign counters + suppression.
 * OTP yoga domain must never point here.
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
    const resendId = payload.data?.email_id?.trim() ?? "";
    if (!type || !resendId) {
      return json({ ok: true, skipped: "missing type or email_id" });
    }

    const mapped = mapResendEventType(type);
    const db = createServiceSupabase();

    const { data: send } = await db
      .from("email_campaign_sends")
      .select("id, campaign_id, contact_id, status")
      .eq("resend_id", resendId)
      .maybeSingle();

    const { error: insertError } = await db.from("email_events").insert({
      send_id: send?.id ?? null,
      contact_id: send?.contact_id ?? null,
      campaign_id: send?.campaign_id ?? null,
      resend_id: resendId,
      event_type: mapped.eventType,
      payload,
    });

    // Unique (resend_id, event_type) → idempotent
    if (insertError) {
      if (insertError.code === "23505") {
        return json({ ok: true, duplicate: true });
      }
      throw insertError;
    }

    if (send && mapped.sendStatus) {
      const rank: Record<string, number> = {
        queued: 0,
        sent: 1,
        delivered: 2,
        opened: 3,
        clicked: 4,
        bounced: 5,
        complained: 5,
        failed: 5,
        skipped: 0,
      };
      const current = rank[send.status] ?? 0;
      const next = rank[mapped.sendStatus] ?? 0;
      if (next >= current) {
        await db
          .from("email_campaign_sends")
          .update({ status: mapped.sendStatus })
          .eq("id", send.id);
      }
    }

    if (send?.campaign_id && mapped.campaignCounter) {
      const counter = mapped.campaignCounter;
      const { data: campaign } = await db
        .from("email_campaigns")
        .select(
          "delivered_count, opened_count, clicked_count, bounced_count, complained_count",
        )
        .eq("id", send.campaign_id)
        .maybeSingle();
      if (campaign && counter in campaign) {
        const prev = Number((campaign as Record<string, number>)[counter] ?? 0);
        await db
          .from("email_campaigns")
          .update({ [counter]: prev + 1, updated_at: new Date().toISOString() })
          .eq("id", send.campaign_id);
      }
    }

    if (send?.contact_id && mapped.suppressStatus) {
      await db
        .from("email_contacts")
        .update({
          marketing_status: mapped.suppressStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", send.contact_id)
        .in("marketing_status", ["active"]);
    }

    if (send?.contact_id && type === "email.opened") {
      await db
        .from("email_contacts")
        .update({ last_open_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", send.contact_id);
    }
    if (send?.contact_id && type === "email.clicked") {
      await db
        .from("email_contacts")
        .update({ last_click_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", send.contact_id);
    }

    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
