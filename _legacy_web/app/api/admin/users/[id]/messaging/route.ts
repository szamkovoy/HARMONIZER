import { parseStringRecord } from "../../../../_utils/contentLocaleFallback";
import { enrollContactManual } from "../../../../_utils/emailAutomationRunner";
import { resolveExactEmailCopy } from "../../../../_utils/emailCopy";
import {
  applyEmailPlaceholders,
  wrapMarketingEmailHtml,
} from "../../../../_utils/emailTemplate";
import {
  buildSignedUnsubscribeUrl,
  generateUnsubscribeToken,
} from "../../../../_utils/emailUnsubscribe";
import { htmlToPlaintext, sendMarketingEmail } from "../../../../_utils/marketingMail";
import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../../_utils/supabase";
import { emailsByUserId } from "../../../_utils/authEmails";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

type Body =
  | { action: "launch_chain"; automation_id: string }
  | { action: "send_campaign"; campaign_id: string };

/**
 * User-card actions: launch automation, send campaign email, or trigger push via notifications API shape.
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    await requireAdmin(req);
    const { id: userId } = await ctx.params;
    const body = (await req.json()) as Body;
    const db = createServiceSupabase();

    if (body.action === "launch_chain") {
      await db.rpc("sync_email_contacts_from_users");
      const { data: contact } = await db
        .from("email_contacts")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();
      if (!contact) {
        return json({ error: "Нет email-контакта — сначала синхронизируйте контакты" }, { status: 400 });
      }
      const result = await enrollContactManual(db, body.automation_id, contact.id);
      if (!result.ok) return json({ error: result.error }, { status: 400 });
      // Process immediately if delay 0
      const { processDueAutomationSteps } = await import(
        "../../../../_utils/emailAutomationRunner"
      );
      const due = await processDueAutomationSteps(db);
      return json({ ok: true, enrolled: true, ...due });
    }

    if (body.action === "send_campaign") {
      const emails = await emailsByUserId(db, [userId]);
      const email = emails.get(userId);
      if (!email || email === "—") {
        return json({ error: "У пользователя нет email" }, { status: 400 });
      }
      await db.rpc("sync_email_contacts_from_users");
      const { data: contact } = await db
        .from("email_contacts")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (!contact) {
        return json({ error: "Нет email-контакта" }, { status: 400 });
      }

      const { data: campaign, error: campError } = await db
        .from("email_campaigns")
        .select("*")
        .eq("id", body.campaign_id)
        .maybeSingle();
      if (campError) throw campError;
      if (!campaign) return json({ error: "Кампания не найдена" }, { status: 404 });

      const { data: user } = await db
        .from("users")
        .select("display_name")
        .eq("id", userId)
        .maybeSingle();

      const exact = resolveExactEmailCopy(contact.locale || "ru", {
        subject: campaign.subject || "",
        htmlBody: campaign.html_body || "",
        subjectI18n: parseStringRecord(campaign.subject_i18n),
        htmlBodyI18n: parseStringRecord(campaign.html_body_i18n),
      });
      if (!exact) {
        return json(
          { error: `Нет перевода письма на locale «${contact.locale || "ru"}»` },
          { status: 400 },
        );
      }

      let token = contact.unsubscribe_token as string | null;
      if (!token) {
        token = generateUnsubscribeToken();
        await db
          .from("email_contacts")
          .update({ unsubscribe_token: token })
          .eq("id", contact.id);
      }
      const name = (user?.display_name ?? "").trim() || email.split("@")[0] || "";
      const subject = applyEmailPlaceholders(exact.subject, { name });
      const bodyHtml = applyEmailPlaceholders(exact.htmlBody, { name });
      const unsubscribeUrl = buildSignedUnsubscribeUrl(token);
      const html = wrapMarketingEmailHtml({
        bodyHtml,
        unsubscribeUrl,
        previewText: subject,
      });
      const result = await sendMarketingEmail({
        to: email,
        subject,
        html,
        text: htmlToPlaintext(html),
        unsubscribeUrl,
        tags: [
          { name: "campaign_id", value: campaign.id },
          { name: "kind", value: "user_card" },
        ],
      });
      if (!result.ok) return json({ error: result.detail }, { status: 502 });

      await db.from("email_campaign_sends").upsert(
        {
          campaign_id: campaign.id,
          contact_id: contact.id,
          locale: exact.locale,
          resend_id: result.resendId,
          status: "sent",
        },
        { onConflict: "campaign_id,contact_id" },
      );
      await db
        .from("email_contacts")
        .update({ last_sent_at: new Date().toISOString() })
        .eq("id", contact.id);

      return json({ ok: true, resend_id: result.resendId });
    }

    return json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
