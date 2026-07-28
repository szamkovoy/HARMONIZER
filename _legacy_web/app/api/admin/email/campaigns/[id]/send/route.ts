import { parseStringRecord } from "../../../../../_utils/contentLocaleFallback";
import { resolveExactEmailCopy } from "../../../../../_utils/emailCopy";
import {
  parseEmailSegmentQuery,
  resolveCampaignRecipients,
} from "../../../../../_utils/emailSegment";
import {
  newEmailTrackId,
  prepareTrackedMarketingEmailHtml,
  registerEmailTrackKey,
} from "../../../../../_utils/emailFirstPartyTracking";
import { applyEmailPlaceholders } from "../../../../../_utils/emailTemplate";
import { buildSignedUnsubscribeUrl, generateUnsubscribeToken } from "../../../../../_utils/emailUnsubscribe";
import {
  htmlToPlaintext,
  sendMarketingEmail,
  sleep,
} from "../../../../../_utils/marketingMail";
import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../../../_utils/supabase";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

type SendBody = {
  /** If set, send only to this address (must match an active contact or create ephemeral test). */
  test_to?: string;
};

/**
 * Send campaign to segment (exact locale) or a single test address.
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
    if (campaign.status === "sending") {
      return json({ error: "Кампания уже отправляется" }, { status: 409 });
    }
    if (campaign.status === "sent" && !testTo) {
      return json({ error: "Кампания уже отправлена — скопируйте для новой рассылки" }, { status: 409 });
    }

    const copySource = {
      subject: (campaign.subject as string) || "",
      htmlBody: (campaign.html_body as string) || "",
      subjectI18n: parseStringRecord(campaign.subject_i18n),
      htmlBodyI18n: parseStringRecord(campaign.html_body_i18n),
    };

    if (testTo) {
      const { data: contact } = await db
        .from("email_contacts")
        .select("*")
        .eq("email_normalized", testTo)
        .maybeSingle();

      let locale = "ru";
      let unsubToken = contact?.unsubscribe_token as string | null;
      if (contact) {
        locale = contact.locale || "ru";
      }
      if (!unsubToken) {
        unsubToken = generateUnsubscribeToken();
        if (contact) {
          await db
            .from("email_contacts")
            .update({ unsubscribe_token: unsubToken })
            .eq("id", contact.id);
        }
      }

      const exact = resolveExactEmailCopy(locale, copySource);
      if (!exact) {
        return json(
          {
            error: `Нет точного перевода на locale «${locale}» для тестового адреса`,
          },
          { status: 400 },
        );
      }

      const unsubscribeUrl = buildSignedUnsubscribeUrl(unsubToken);
      const trackId = newEmailTrackId();
      const html = await prepareTrackedMarketingEmailHtml({
        bodyHtml: exact.htmlBody,
        unsubscribeUrl,
        previewText: exact.subject,
        trackId,
      });
      const result = await sendMarketingEmail({
        to: testTo,
        subject: exact.subject,
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

    await db
      .from("email_campaigns")
      .update({ status: "sending", updated_at: new Date().toISOString() })
      .eq("id", id);

    // Keep contacts fresh before resolving the segment.
    await db.rpc("sync_email_contacts_from_users");

    const segment = parseEmailSegmentQuery(campaign.segment_query);
    const { eligible, skippedLocaleCount: skippedLocale, no_audience } =
      await resolveCampaignRecipients(db, segment, copySource);

    if (no_audience) {
      await db
        .from("email_campaigns")
        .update({
          status: "failed",
          skipped_locale_count: 0,
          recipient_count: 0,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      return json(
        {
          error:
            "Сегмент без аудитории: выберите чип («Вся база» / тариф / «Все установившие») или укажите фрагмент email.",
        },
        { status: 400 },
      );
    }

    if (eligible.length === 0) {
      await db
        .from("email_campaigns")
        .update({
          status: "failed",
          skipped_locale_count: skippedLocale,
          recipient_count: 0,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      return json(
        {
          error:
            skippedLocale > 0
              ? "Нет получателей с переводом на язык контакта. Заполните вкладки или смените сегмент."
              : "В сегменте никого нет — проверьте фильтры.",
          skipped_locale_count: skippedLocale,
        },
        { status: 400 },
      );
    }

    let sentCount = 0;
    let errorCount = 0;

    for (const row of eligible) {
      let token = row.contact.unsubscribe_token;
      if (!token) {
        token = generateUnsubscribeToken();
        await db
          .from("email_contacts")
          .update({ unsubscribe_token: token })
          .eq("id", row.contact.id);
      }

      let displayName = "";
      if (row.contact.user_id) {
        const { data: u } = await db
          .from("users")
          .select("display_name")
          .eq("id", row.contact.user_id)
          .maybeSingle();
        displayName = (u?.display_name ?? "").trim();
      }
      const name =
        displayName || row.contact.email.split("@")[0] || "";
      const subject = applyEmailPlaceholders(row.subject, { name });
      const bodyHtml = applyEmailPlaceholders(row.htmlBody, { name });

      const unsubscribeUrl = buildSignedUnsubscribeUrl(token);
      const trackId = newEmailTrackId();
      const html = await prepareTrackedMarketingEmailHtml({
        bodyHtml,
        unsubscribeUrl,
        previewText: subject,
        trackId,
      });

      const { data: sendRow, error: sendInsertError } = await db
        .from("email_campaign_sends")
        .upsert(
          {
            campaign_id: id,
            contact_id: row.contact.id,
            locale: row.locale,
            status: "queued",
          },
          { onConflict: "campaign_id,contact_id" },
        )
        .select("id")
        .single();
      if (sendInsertError) {
        errorCount += 1;
        continue;
      }

      const result = await sendMarketingEmail({
        to: row.contact.email,
        subject,
        html,
        text: htmlToPlaintext(html),
        unsubscribeUrl,
        locale: row.locale,
        tags: [
          { name: "campaign_id", value: id },
          { name: "contact_id", value: row.contact.id },
        ],
      });

      if (result.ok) {
        sentCount += 1;
        await db
          .from("email_campaign_sends")
          .update({ status: "sent", resend_id: result.resendId })
          .eq("id", sendRow.id);
        await registerEmailTrackKey(db, {
          trackId,
          resendId: result.resendId,
          contactId: row.contact.id,
          campaignId: id,
          sendId: sendRow.id,
        });
        await db
          .from("email_contacts")
          .update({ last_sent_at: new Date().toISOString() })
          .eq("id", row.contact.id);
      } else {
        errorCount += 1;
        await db
          .from("email_campaign_sends")
          .update({ status: "failed", error_detail: result.detail.slice(0, 500) })
          .eq("id", sendRow.id);
      }

      // Soft rate limit (~2 req/s)
      await sleep(500);
    }

    const { data: updated, error: finishError } = await db
      .from("email_campaigns")
      .update({
        status: errorCount > 0 && sentCount === 0 ? "failed" : "sent",
        recipient_count: eligible.length,
        skipped_locale_count: skippedLocale,
        sent_count: sentCount,
        error_count: errorCount,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();
    if (finishError) throw finishError;

    return json({
      campaign: updated,
      sent_count: sentCount,
      error_count: errorCount,
      skipped_locale_count: skippedLocale,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
