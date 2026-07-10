import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";
import { PAID_TIERS, recomputeUserMembershipFromPayments } from "../../_utils/payments";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

type PaymentUpdatePayload = {
  tier?: string;
  expires_at?: string | null;
  amount?: number;
  comment?: string;
};

/** Редактирование строки леджера; всегда пересчитывает тариф пользователя из действующих платежей. */
export async function PATCH(req: Request, ctx: RouteContext) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const payload = (await req.json()) as PaymentUpdatePayload;

    const tier = payload.tier?.trim() ?? "";
    if (!PAID_TIERS.has(tier)) {
      return json({ error: `Недопустимый тариф: ${tier || "не указан"}` }, { status: 400 });
    }
    const expiresAt = payload.expires_at ?? null;
    if (expiresAt && Number.isNaN(Date.parse(expiresAt))) {
      return json({ error: "Некорректная дата окончания" }, { status: 400 });
    }

    const db = createServiceSupabase();
    const { data: existing, error: readError } = await db
      .from("payments")
      .select("id, user_id")
      .eq("id", id)
      .maybeSingle();
    if (readError) throw readError;
    if (!existing) return json({ error: "Платёж не найден" }, { status: 404 });

    const { data: payment, error } = await db
      .from("payments")
      .update({
        tier,
        paid_until: expiresAt,
        amount: typeof payload.amount === "number" && payload.amount >= 0 ? payload.amount : 0,
        comment: payload.comment?.trim() || null,
        edited_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("id, user_id, amount, currency, tier, paid_until, source, comment, created_at, edited_at")
      .single();
    if (error) throw error;

    await recomputeUserMembershipFromPayments(db, existing.user_id);

    return json({ payment });
  } catch (error) {
    return errorResponse(error);
  }
}
