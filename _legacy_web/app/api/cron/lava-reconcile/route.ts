import { reconcilePendingLavaPayments } from "../../account/lavaReconcile";
import { runPaymentFailedNotices } from "../../account/paymentFailedNotices";
import { createServiceSupabase, errorResponse, json } from "../../_utils/supabase";

export const runtime = "nodejs";
export const maxDuration = 120;

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

/** Every 10 minutes: Lava invoices already paid, whose webhook never updated us. Then the first-payment failure letter. */
export async function POST(req: Request) {
  const unauthorized = assertCronSecret(req);
  if (unauthorized) return unauthorized;
  try {
    const db = createServiceSupabase();
    const result = await reconcilePendingLavaPayments(db);
    console.log("[lava-reconcile]", result);
    let notices: unknown = null;
    try {
      notices = await runPaymentFailedNotices(db);
      console.log("[payment-failed-notice]", notices);
    } catch (error) {
      console.error("[payment-failed-notice]", error);
      notices = { error: error instanceof Error ? error.message : "notice failed" };
    }
    return json({ ok: true, ...result, notices });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(req: Request) {
  return POST(req);
}
