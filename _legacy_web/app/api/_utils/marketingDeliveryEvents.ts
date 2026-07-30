/**
 * Shared campaign/automation counter + suppress updates for Resend and SES webhooks.
 * `providerMessageId` is stored in DB column `resend_id`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type MarketingDeliveryMapped = {
  eventType: string;
  sendStatus: string | null;
  campaignCounter: string | null;
  suppressStatus: "suppressed" | "complained" | "active" | null;
  isHardBounce: boolean;
  addToResendSuppressions: boolean;
  removeFromResendSuppressions: boolean;
};

export async function applyMarketingDeliveryEvent(
  db: SupabaseClient,
  params: {
    providerMessageId: string;
    mapped: MarketingDeliveryMapped;
    recipients: string[];
    rawPayload: unknown;
    /** When true, bump opened/clicked last_* on contact (Resend open/click only). */
    touchOpenClickTimestamps?: boolean;
  },
): Promise<{
  ok: true;
  duplicate?: boolean;
  hard_bounce: boolean;
  suppressed_local: boolean;
}> {
  const {
    providerMessageId,
    mapped,
    recipients,
    rawPayload,
    touchOpenClickTimestamps,
  } = params;

  let send: {
    id: string;
    campaign_id: string | null;
    step_id: string | null;
    contact_id: string | null;
    status: string;
    kind: "campaign" | "automation";
  } | null = null;

  if (providerMessageId) {
    const { data: campaignSend } = await db
      .from("email_campaign_sends")
      .select("id, campaign_id, contact_id, status")
      .eq("resend_id", providerMessageId)
      .maybeSingle();
    if (campaignSend) {
      send = { ...campaignSend, step_id: null, kind: "campaign" };
    } else {
      const { data: autoSend } = await db
        .from("email_automation_sends")
        .select("id, contact_id, status, step_id")
        .eq("resend_id", providerMessageId)
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

  let contactId = send?.contact_id ?? null;
  if (!contactId && recipients.length) {
    const { data: contact } = await db
      .from("email_contacts")
      .select("id")
      .eq("email_normalized", recipients[0]!.toLowerCase())
      .maybeSingle();
    contactId = contact?.id ?? null;
  }

  const { error: insertError } = await db.from("email_events").insert({
    send_id: send?.kind === "campaign" ? send.id : null,
    contact_id: contactId,
    campaign_id: send?.campaign_id ?? null,
    resend_id: providerMessageId || null,
    event_type: mapped.eventType,
    payload: rawPayload,
  });

  if (insertError) {
    if (insertError.code === "23505") {
      return {
        ok: true,
        duplicate: true,
        hard_bounce: mapped.isHardBounce,
        suppressed_local: false,
      };
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

  if (contactId && mapped.suppressStatus) {
    if (mapped.suppressStatus === "active") {
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

  if (touchOpenClickTimestamps && contactId) {
    if (mapped.eventType === "email.opened" || mapped.eventType === "opened") {
      await db
        .from("email_contacts")
        .update({
          last_open_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", contactId);
    }
    if (mapped.eventType === "email.clicked" || mapped.eventType === "clicked") {
      await db
        .from("email_contacts")
        .update({
          last_click_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", contactId);
    }
  }

  return {
    ok: true,
    hard_bounce: mapped.isHardBounce,
    suppressed_local: Boolean(
      mapped.suppressStatus && mapped.suppressStatus !== "active",
    ),
  };
}

/** Map SES eventType / notificationType → same shape as Resend webhook mapping. */
export function mapSesEventType(event: {
  eventType?: string;
  notificationType?: string;
  bounce?: { bounceType?: string };
}): MarketingDeliveryMapped {
  const type = (event.eventType || event.notificationType || "").trim();
  const bounceType = event.bounce?.bounceType?.trim() ?? "";

  if (type === "Send") {
    return {
      eventType: "email.sent",
      sendStatus: "sent",
      campaignCounter: null,
      suppressStatus: null,
      isHardBounce: false,
      addToResendSuppressions: false,
      removeFromResendSuppressions: false,
    };
  }
  if (type === "Delivery") {
    return {
      eventType: "email.delivered",
      sendStatus: "delivered",
      campaignCounter: "delivered_count",
      suppressStatus: null,
      isHardBounce: false,
      addToResendSuppressions: false,
      removeFromResendSuppressions: false,
    };
  }
  if (type === "Bounce") {
    const hard = bounceType === "Permanent";
    return {
      eventType: "email.bounced",
      sendStatus: "bounced",
      campaignCounter: "bounced_count",
      suppressStatus: hard ? "suppressed" : null,
      isHardBounce: hard,
      addToResendSuppressions: false,
      removeFromResendSuppressions: false,
    };
  }
  if (type === "Complaint") {
    return {
      eventType: "email.complained",
      sendStatus: "complained",
      campaignCounter: "complained_count",
      suppressStatus: "complained",
      isHardBounce: false,
      addToResendSuppressions: false,
      removeFromResendSuppressions: false,
    };
  }
  if (type === "Reject" || type === "Rendering Failure") {
    return {
      eventType: "email.failed",
      sendStatus: "failed",
      campaignCounter: null,
      suppressStatus: null,
      isHardBounce: false,
      addToResendSuppressions: false,
      removeFromResendSuppressions: false,
    };
  }
  // Open/Click from SES optional — we prefer first-party; still record if present.
  if (type === "Open") {
    return {
      eventType: "email.opened",
      sendStatus: "opened",
      campaignCounter: "opened_count",
      suppressStatus: null,
      isHardBounce: false,
      addToResendSuppressions: false,
      removeFromResendSuppressions: false,
    };
  }
  if (type === "Click") {
    return {
      eventType: "email.clicked",
      sendStatus: "clicked",
      campaignCounter: "clicked_count",
      suppressStatus: null,
      isHardBounce: false,
      addToResendSuppressions: false,
      removeFromResendSuppressions: false,
    };
  }
  return {
    eventType: type || "email.unknown",
    sendStatus: null,
    campaignCounter: null,
    suppressStatus: null,
    isHardBounce: false,
    addToResendSuppressions: false,
    removeFromResendSuppressions: false,
  };
}
