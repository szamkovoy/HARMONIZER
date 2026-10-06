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

/**
 * sent/delivered are the bulk of webhook traffic (two per letter) and carry
 * nothing the send row status does not already hold — they get no event row.
 */
const EVENT_TYPES_WITHOUT_ROW = new Set(["email.sent", "email.delivered"]);

function pick(obj: unknown, keys: string[]): Record<string, unknown> | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = (obj as Record<string, unknown>)[k];
    if (v !== undefined && v !== null) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Raw webhook payloads averaged ~830 bytes and included headers, subject and
 * the full recipient list. Keep only what the admin reads, in the same
 * `{type, created_at, data:{…}}` shape the deliverability report parses.
 */
export function compactDeliveryPayload(rawPayload: unknown): Record<string, unknown> {
  if (!rawPayload || typeof rawPayload !== "object") return {};
  const root = rawPayload as Record<string, unknown>;
  const src = (root.data && typeof root.data === "object" ? root.data : root) as Record<
    string,
    unknown
  >;
  const out: Record<string, unknown> = {};
  const type = root.type ?? root.eventType ?? root.notificationType;
  if (typeof type === "string") out.type = type;
  if (typeof root.created_at === "string") out.created_at = root.created_at;

  const data: Record<string, unknown> = {};
  const to = Array.isArray(src.to) ? src.to.filter((x) => typeof x === "string").slice(0, 1) : null;
  if (to?.length) data.to = to;
  else if (typeof src.email === "string") data.to = [src.email];
  const sesMail = root.mail as { destination?: unknown } | undefined;
  if (!data.to && Array.isArray(sesMail?.destination) && typeof sesMail.destination[0] === "string") {
    data.to = [sesMail.destination[0]];
  }
  const bounce =
    pick(src.bounce, ["type", "subType", "message"]) ??
    (() => {
      const b = pick(root.bounce, ["bounceType", "bounceSubType"]);
      return b ? { type: b.bounceType, subType: b.bounceSubType } : undefined;
    })();
  if (bounce) data.bounce = bounce;
  const failed = pick(src.failed, ["reason"]);
  if (failed) data.failed = failed;
  const suppressed = pick(src.suppressed, ["reason", "message"]);
  if (suppressed) data.suppressed = suppressed;
  const click = pick(src.click, ["link"]);
  if (click) data.click = click;
  const complaint = pick(root.complaint, ["complaintFeedbackType"]);
  if (complaint) data.complaint = complaint;
  if (Object.keys(data).length) out.data = data;
  return out;
}

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

  const recordEvent = !EVENT_TYPES_WITHOUT_ROW.has(mapped.eventType);
  const detail = compactDeliveryPayload(rawPayload);
  const touch =
    touchOpenClickTimestamps &&
    (mapped.eventType === "email.opened" || mapped.eventType === "opened")
      ? "open"
      : touchOpenClickTimestamps &&
          (mapped.eventType === "email.clicked" || mapped.eventType === "clicked")
        ? "click"
        : null;

  // Campaign letters: one RPC does lookup, event, status, counter, suppress, touch.
  if (providerMessageId) {
    const { data, error } = await db.rpc("apply_email_campaign_delivery", {
      p_resend_id: providerMessageId,
      p_event_type: mapped.eventType,
      p_send_status: mapped.sendStatus,
      p_counter: mapped.campaignCounter,
      p_record_event: recordEvent,
      p_detail: detail,
      p_suppress_status: mapped.suppressStatus,
      p_touch: touch,
    });
    if (error) throw error;
    if (data && typeof data === "object") {
      const dup = Boolean((data as { duplicate?: boolean }).duplicate);
      return {
        ok: true,
        duplicate: dup || undefined,
        hard_bounce: mapped.isHardBounce,
        suppressed_local: !dup && Boolean(mapped.suppressStatus && mapped.suppressStatus !== "active"),
      };
    }
  }

  // Automations and letters without a send row: the old path, minus sent/delivered rows.
  let send: {
    id: string;
    campaign_id: string | null;
    step_id: string | null;
    contact_id: string | null;
    status: string;
    kind: "campaign" | "automation";
  } | null = null;

  if (providerMessageId) {
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

  let contactId = send?.contact_id ?? null;
  if (!contactId && recipients.length) {
    const { data: contact } = await db
      .from("email_contacts")
      .select("id")
      .eq("email_normalized", recipients[0]!.toLowerCase())
      .maybeSingle();
    contactId = contact?.id ?? null;
  }

  if (recordEvent) {
    const { error: insertError } = await db.from("email_events").insert({
      send_id: null,
      contact_id: contactId,
      campaign_id: null,
      resend_id: providerMessageId || null,
      event_type: mapped.eventType,
      payload: detail,
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
  } else if (!send) {
    // sent/delivered for an unknown letter: nothing to update.
    return { ok: true, hard_bounce: false, suppressed_local: false };
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
  bounce?: { bounceType?: string; bounceSubType?: string };
}): MarketingDeliveryMapped {
  const type = (event.eventType || event.notificationType || "").trim();
  const bounceType = event.bounce?.bounceType?.trim() ?? "";
  const bounceSubType = (event.bounce?.bounceSubType ?? "").trim().toLowerCase();

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
    // MailboxFull is Transient at Gmail but marketing should stop (OTP unaffected).
    const suppress = hard || bounceSubType === "mailboxfull";
    return {
      eventType: "email.bounced",
      sendStatus: "bounced",
      campaignCounter: "bounced_count",
      suppressStatus: suppress ? "suppressed" : null,
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
