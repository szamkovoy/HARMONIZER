import {
  addResendSuppression,
  removeResendSuppression,
} from "../../_utils/resendMarketingApi";
import { createServiceSupabase, errorResponse, json } from "../../_utils/supabase";
import {
  extractRecipientEmails,
  mapResendEventType,
  verifyResendMarketingWebhook,
  type ResendWebhookPayload,
} from "../../_utils/resendWebhook";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * Resend marketing webhooks → email_events + campaign counters + auto-suppress.
 * OTP yoga domain must never point here.
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

    const resendId = payload.data?.email_id?.trim() ?? "";
    const mapped = mapResendEventType(type, payload);
    const db = createServiceSupabase();
    const recipients = extractRecipientEmails(payload);

    // Match campaign send or automation send by Resend id.
    let send: {
      id: string;
      campaign_id: string | null;
      step_id: string | null;
      contact_id: string | null;
      status: string;
      kind: "campaign" | "automation";
    } | null = null;

    if (resendId) {
      const { data: campaignSend } = await db
        .from("email_campaign_sends")
        .select("id, campaign_id, contact_id, status")
        .eq("resend_id", resendId)
        .maybeSingle();
      if (campaignSend) {
        send = { ...campaignSend, step_id: null, kind: "campaign" };
      } else {
        const { data: autoSend } = await db
          .from("email_automation_sends")
          .select("id, contact_id, status, step_id")
          .eq("resend_id", resendId)
          .maybeSingle();
        if (autoSend) {
          send = {
            id: autoSend.id,
            campaign_id: null,
            step_id: autoSend.step_id ?? null,
            contact_id: autoSend.contact_id,
            status: autoSend.status,
            kind: "automation",
          };
        }
      }
    }

    // Resolve contact by recipient email when send not linked.
    let contactId = send?.contact_id ?? null;
    if (!contactId && recipients.length) {
      const { data: contact } = await db
        .from("email_contacts")
        .select("id")
        .eq("email_normalized", recipients[0])
        .maybeSingle();
      contactId = contact?.id ?? null;
    }

    const { error: insertError } = await db.from("email_events").insert({
      send_id: send?.kind === "campaign" ? send.id : null,
      contact_id: contactId,
      campaign_id: send?.campaign_id ?? null,
      resend_id: resendId || null,
      event_type: mapped.eventType,
      payload,
    });

    if (insertError) {
      if (insertError.code === "23505") {
        return json({ ok: true, duplicate: true });
      }
      throw insertError;
    }

    if (send?.kind === "campaign" && mapped.sendStatus) {
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

    if (send?.kind === "automation" && mapped.sendStatus) {
      const autoStatus =
        mapped.sendStatus === "bounced" ||
        mapped.sendStatus === "complained" ||
        mapped.sendStatus === "failed"
          ? "failed"
          : mapped.sendStatus === "skipped"
            ? "skipped"
            : "sent";
      await db
        .from("email_automation_sends")
        .update({ status: autoStatus })
        .eq("id", send.id);
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

    // Automation step counters (same event → counter mapping as campaigns).
    if (send?.kind === "automation" && send.step_id) {
      let stepCounter: string | null = mapped.campaignCounter;
      if (mapped.sendStatus === "failed") stepCounter = "failed_count";
      if (stepCounter) {
        const { data: step } = await db
          .from("email_automation_steps")
          .select(
            "delivered_count, opened_count, clicked_count, bounced_count, complained_count, failed_count",
          )
          .eq("id", send.step_id)
          .maybeSingle();
        if (step && stepCounter in step) {
          const prev = Number((step as Record<string, number>)[stepCounter] ?? 0);
          await db
            .from("email_automation_steps")
            .update({
              [stepCounter]: prev + 1,
              updated_at: new Date().toISOString(),
            })
            .eq("id", send.step_id);
        }
      }
    }

    // Local contact status
    if (contactId && mapped.suppressStatus) {
      if (mapped.suppressStatus === "active") {
        // Only restore from suppressed via suppression.removed — not from complained.
        await db
          .from("email_contacts")
          .update({
            marketing_status: "active",
            updated_at: new Date().toISOString(),
          })
          .eq("id", contactId)
          .eq("marketing_status", "suppressed");
      } else {
        await db
          .from("email_contacts")
          .update({
            marketing_status: mapped.suppressStatus,
            updated_at: new Date().toISOString(),
          })
          .eq("id", contactId)
          .in("marketing_status", ["active"]);
      }
    }

    // Mirror hard bounce / complaint to Resend suppression list.
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
    // suppression.removed: also clear Resend is already done by Resend; restore local above.

    if (contactId && type === "email.opened") {
      await db
        .from("email_contacts")
        .update({
          last_open_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", contactId);
    }
    if (contactId && type === "email.clicked") {
      await db
        .from("email_contacts")
        .update({
          last_click_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", contactId);
    }

    return json({
      ok: true,
      hard_bounce: mapped.isHardBounce,
      suppressed_local: Boolean(mapped.suppressStatus && mapped.suppressStatus !== "active"),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
