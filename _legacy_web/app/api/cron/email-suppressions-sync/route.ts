import { resolveMarketingTransportProfile } from "../../_utils/emailTransportProfile";
import { syncResendSuppressionsToContacts } from "../../_utils/syncResendSuppressions";
import { createServiceSupabase, errorResponse, json } from "../../_utils/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

function assertCronSecret(req: Request): Response | null {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) {
    return json({ error: "CRON_SECRET is required" }, { status: 500 });
  }
  const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const header = req.headers.get("x-cron-secret");
  if (bearer === expected || header === expected) return null;
  return json({ error: "Unauthorized" }, { status: 401 });
}

/** Daily cron: Resend suppression list → email_contacts.marketing_status. */
export async function POST(req: Request) {
  const unauthorized = assertCronSecret(req);
  if (unauthorized) return unauthorized;
  try {
    const marketing = resolveMarketingTransportProfile({
      EMAIL_MARKETING: process.env.EMAIL_MARKETING,
    });
    if (marketing.provider !== "resend") {
      return json({
        ok: true,
        skipped: true,
        reason: `EMAIL_MARKETING=${marketing.id} — Resend suppressions sync not applicable`,
      });
    }
    const result = await syncResendSuppressionsToContacts(createServiceSupabase(), {
      maxPages: 10,
    });
    if (result.error && result.resend_count === 0) {
      return json({ ok: false, ...result }, { status: 502 });
    }
    return json({ ok: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(req: Request) {
  return POST(req);
}
