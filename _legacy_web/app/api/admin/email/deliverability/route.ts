import { buildDeliverabilityReport } from "../../../_utils/emailDeliverability";
import {
  addResendSuppression,
  listResendSuppressions,
  removeResendSuppression,
} from "../../../_utils/resendMarketingApi";
import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

function parseDays(raw: string | null): 7 | 30 | 90 {
  const n = Number(raw);
  if (n === 7 || n === 30 || n === 90) return n;
  return 30;
}

/** Deliverability dashboard: local metrics + Resend suppressions list. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const url = new URL(req.url);
    const days = parseDays(url.searchParams.get("days"));
    const db = createServiceSupabase();

    const [report, suppressions] = await Promise.all([
      buildDeliverabilityReport(db, days),
      listResendSuppressions({ limit: 100, maxPages: 3 }),
    ]);

    return json({
      ...report,
      resend: {
        suppressions: suppressions.suppressions,
        suppressions_error: suppressions.error ?? null,
        suppressions_count: suppressions.suppressions.length,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

type ActionBody =
  | { action: "suppress"; email: string }
  | { action: "unsuppress"; email: string; restore_contact?: boolean };

/**
 * Manual suppress / unsuppress + sync Resend list → local contacts.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const body = (await req.json()) as ActionBody;
    const db = createServiceSupabase();

    if (body.action === "suppress") {
      const email = body.email?.trim().toLowerCase();
      if (!email) return json({ error: "email обязателен" }, { status: 400 });
      const remote = await addResendSuppression(email);
      const { data: contact } = await db
        .from("email_contacts")
        .update({
          marketing_status: "suppressed",
          updated_at: new Date().toISOString(),
        })
        .eq("email_normalized", email)
        .select("id")
        .maybeSingle();
      return json({
        ok: true,
        resend: remote,
        contact_id: contact?.id ?? null,
      });
    }

    if (body.action === "unsuppress") {
      const email = body.email?.trim().toLowerCase();
      if (!email) return json({ error: "email обязателен" }, { status: 400 });
      const remote = await removeResendSuppression(email);
      let restored = false;
      if (body.restore_contact !== false) {
        const { data } = await db
          .from("email_contacts")
          .update({
            marketing_status: "active",
            updated_at: new Date().toISOString(),
          })
          .eq("email_normalized", email)
          .in("marketing_status", ["suppressed", "complained"])
          .select("id")
          .maybeSingle();
        restored = Boolean(data);
      }
      return json({ ok: true, resend: remote, restored });
    }

    return json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    return errorResponse(error);
  }
}
