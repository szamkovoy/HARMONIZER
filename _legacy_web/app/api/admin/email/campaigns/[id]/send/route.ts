import { after } from "next/server";

import { parseStringRecord } from "../../../../../_utils/contentLocaleFallback";
import { resolveExactEmailCopy } from "../../../../../_utils/emailCopy";
import { runCampaignSend } from "../../../../../_utils/emailCampaignSend";
import {
  newEmailTrackId,
  prepareTrackedMarketingEmailHtml,
  registerEmailTrackKey,
} from "../../../../../_utils/emailFirstPartyTracking";
import { applyEmailPlaceholders } from "../../../../../_utils/emailTemplate";
import { buildSignedUnsubscribeUrl, generateUnsubscribeToken } from "../../../../../_utils/emailUnsubscribe";
import { htmlToPlaintext, sendMarketingEmail } from "../../../../../_utils/marketingMail";
import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../../../_utils/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

type SendBody = {
  test_to?: string;
  /** Enqueue the next warmup slice. Default true. False = only drain leftover queued. */
  start_wave?: boolean;
};

/**
 * Test send, or start/resume a warmup wave.
 * Contacts already accepted by Resend (sent/delivered/opened/clicked) are skipped.
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as SendBody;
    const testTo = body.test_to?.trim().toLowerCase() || null;

    const db = createServiceSupabase();
    const { data: campaign, error: loadError } = await db
      .from("email_campaigns")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (loadError) throw loadError;
    if (!campaign) return json({ error: "Кампания не найдена" }, { status: 404 });

    if (testTo) {
      const { data: contact } = await db
        .from("email_contacts")
        .select("*")
        .eq("email_normalized", testTo)
        .maybeSingle();

      let locale = "ru";
      let unsubToken = contact?.unsubscribe_token as string | null;
      if (contact) locale = contact.locale || "ru";
      if (!unsubToken) {
        unsubToken = generateUnsubscribeToken();
        if (contact) {
          await db
            .from("email_contacts")
            .update({ unsubscribe_token: unsubToken })
            .eq("id", contact.id);
        }
      }

      const exact = resolveExactEmailCopy(locale, {
        subject: (campaign.subject as string) || "",
        htmlBody: (campaign.html_body as string) || "",
        subjectI18n: parseStringRecord(campaign.subject_i18n),
        htmlBodyI18n: parseStringRecord(campaign.html_body_i18n),
      });
      if (!exact) {
        return json(
          { error: `Нет точного перевода на locale «${locale}» для тестового адреса` },
          { status: 400 },
        );
      }

      const unsubscribeUrl = buildSignedUnsubscribeUrl(unsubToken);
      let displayName = "";
      if (contact?.user_id) {
        const { data: u } = await db
          .from("users")
          .select("display_name")
          .eq("id", contact.user_id)
          .maybeSingle();
        displayName = (u?.display_name ?? "").trim();
      }
      const name = displayName || testTo.split("@")[0] || "";
      const subject = applyEmailPlaceholders(exact.subject, { name, unsubscribeUrl });
      const bodyHtml = applyEmailPlaceholders(exact.htmlBody, { name, unsubscribeUrl });
      const trackId = newEmailTrackId();
      const html = await prepareTrackedMarketingEmailHtml({
        bodyHtml,
        unsubscribeUrl,
        previewText: subject,
        trackId,
      });
      const result = await sendMarketingEmail({
        to: testTo,
        subject,
        html,
        text: htmlToPlaintext(html),
        unsubscribeUrl,
        locale: exact.locale,
        tags: [
          { name: "campaign_id", value: id },
          { name: "kind", value: "test" },
        ],
      });
      if (!result.ok) {
        return json({ error: result.detail }, { status: 502 });
      }
      await registerEmailTrackKey(db, {
        trackId,
        resendId: result.resendId,
        contactId: contact?.id ?? null,
        campaignId: id,
      });
      return json({ ok: true, test: true, resend_id: result.resendId, locale: exact.locale });
    }

    if (campaign.status === "sent") {
      return json(
        { error: "Кампания уже завершена — скопируйте, если нужна другая рассылка" },
        { status: 409 },
      );
    }

    const startWave = body.start_wave !== false;
    await db
      .from("email_campaigns")
      .update({
        status: "sending",
        send_halted_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .neq("status", "sent");

    after(async () => {
      try {
        await runCampaignSend(db, id, { startWave });
      } catch (err) {
        console.error("[email-campaign-send]", err);
      }
    });

    const { data: updated } = await db
      .from("email_campaigns")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    return json({
      campaign: updated,
      started: true,
      status: "sending",
      sent_count: updated?.sent_count ?? campaign.sent_count,
      queued_enqueued: 0,
      timed_out: false,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
