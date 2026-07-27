import { parseStringRecord } from "../../../../../../../_utils/contentLocaleFallback";
import { resolveExactEmailCopy } from "../../../../../../../_utils/emailCopy";
import { wrapMarketingEmailHtml } from "../../../../../../../_utils/emailTemplate";
import {
  buildSignedUnsubscribeUrl,
  generateUnsubscribeToken,
} from "../../../../../../../_utils/emailUnsubscribe";
import {
  htmlToPlaintext,
  sendMarketingEmail,
} from "../../../../../../../_utils/marketingMail";
import {
  createServiceSupabase,
  errorResponse,
  json,
  requireAdmin,
} from "../../../../../../../_utils/supabase";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; stepId: string }> };

type SendBody = {
  test_to?: string;
};

/**
 * Send a test email for one automation step (exact locale, no segment blast).
 */
export async function POST(req: Request, ctx: Ctx) {
  try {
    await requireAdmin(req);
    const { id: automationId, stepId } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as SendBody;
    const testTo = body.test_to?.trim().toLowerCase() || null;
    if (!testTo) {
      return json({ error: "Укажите test_to" }, { status: 400 });
    }

    const db = createServiceSupabase();
    const { data: step, error: stepError } = await db
      .from("email_automation_steps")
      .select("*")
      .eq("id", stepId)
      .eq("automation_id", automationId)
      .maybeSingle();
    if (stepError) throw stepError;
    if (!step) return json({ error: "Письмо цепочки не найдено" }, { status: 404 });

    const copySource = {
      subject: (step.subject as string) || "",
      htmlBody: (step.html_body as string) || "",
      subjectI18n: parseStringRecord(step.subject_i18n),
      htmlBodyI18n: parseStringRecord(step.html_body_i18n),
    };

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
    const html = wrapMarketingEmailHtml({
      bodyHtml: exact.htmlBody,
      unsubscribeUrl,
      previewText: exact.subject,
    });
    const result = await sendMarketingEmail({
      to: testTo,
      subject: exact.subject,
      html,
      text: htmlToPlaintext(html),
      unsubscribeUrl,
      locale: exact.locale,
      tags: [
        { name: "automation_id", value: automationId },
        { name: "automation_step_id", value: stepId },
        { name: "kind", value: "test" },
      ],
    });
    if (!result.ok) {
      return json({ error: result.detail }, { status: 502 });
    }
    return json({
      ok: true,
      test: true,
      resend_id: result.resendId,
      locale: exact.locale,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
