import { cancelActiveSubscriptionsForUser } from "../../../../account/cancelActiveSubscriptions";
import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../../_utils/supabase";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** Admin cancel of active Lava (etc.) subscription — same helper as cabinet. */
export async function DELETE(req: Request, ctx: Ctx) {
  try {
    await requireAdmin(req);
    const { id: userId } = await ctx.params;
    const db = createServiceSupabase();

    const { data: contract, error } = await db
      .from("payment_contracts")
      .select("contract_id, status, current_period_end")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!contract) {
      return json({ error: "Нет активной подписки" }, { status: 404 });
    }

    const { data: authData } = await db.auth.admin.getUserById(userId);
    const email = authData?.user?.email?.trim();
    if (!email) {
      return json({ error: "У пользователя нет email" }, { status: 409 });
    }

    await cancelActiveSubscriptionsForUser(db, { userId, email });

    return json({
      cancelled: true,
      accessUntil: contract.current_period_end,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
