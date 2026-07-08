import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../_utils/supabase";
import { emailsByUserId } from "../_utils/authEmails";

export const runtime = "nodejs";

/** Общий список платежей (свежие сверху) с ФИО и email пользователя. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 200), 500);

    const db = createServiceSupabase();
    const { data, error } = await db
      .from("payments")
      .select(
        "id, user_id, amount, currency, tier, paid_until, source, comment, created_at, edited_at, users(display_name)",
      )
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;

    const userIds = [...new Set((data ?? []).map((p) => p.user_id))];
    const emails = await emailsByUserId(db, userIds);

    const payments = (data ?? []).map((p) => {
      const user = p.users as { display_name?: string | null } | null;
      return {
        id: p.id,
        user_id: p.user_id,
        amount: p.amount,
        currency: p.currency,
        tier: p.tier,
        paid_until: p.paid_until,
        source: p.source,
        comment: p.comment,
        created_at: p.created_at,
        edited_at: p.edited_at,
        display_name: user?.display_name?.trim() || "Без имени",
        email: emails.get(p.user_id) ?? "—",
      };
    });

    return json({ payments });
  } catch (error) {
    return errorResponse(error);
  }
}
