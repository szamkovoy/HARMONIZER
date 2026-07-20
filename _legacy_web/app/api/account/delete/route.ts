import { createServiceSupabase, errorResponse, json, requireUserId } from "../../_utils/supabase";
import { cancelActiveSubscriptionsForUser } from "../cancelActiveSubscriptions";

/**
 * DELETE /api/account/delete — удаление аккаунта из приложения (Bearer JWT).
 *
 * Порядок:
 * 1) отменить активные подписки во всех платёжных провайдерах;
 * 2) сохранить buyer_email на payment_contracts / payments (отчёты без user_id);
 * 3) auth.admin.deleteUser — каскадом чистит public.users и PII;
 *    payment_contracts / payments остаются (FK ON DELETE SET NULL).
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function DELETE(req: Request) {
  try {
    const userId = await requireUserId(req);
    const db = createServiceSupabase();

    const { data: authData, error: authLookupError } = await db.auth.admin.getUserById(userId);
    if (authLookupError) throw authLookupError;
    const email = authData?.user?.email?.trim() || null;
    if (!email) {
      return json({ error: "User has no email" }, { status: 409 });
    }

    await cancelActiveSubscriptionsForUser(db, { userId, email });

    // Снимок email до wipe — отчёты по платежам сохраняют покупателя.
    const { error: contractsEmailError } = await db
      .from("payment_contracts")
      .update({ buyer_email: email, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
    if (contractsEmailError) throw contractsEmailError;

    const { error: paymentsEmailError } = await db
      .from("payments")
      .update({ buyer_email: email })
      .eq("user_id", userId);
    if (paymentsEmailError) throw paymentsEmailError;

    const { error: deleteError } = await db.auth.admin.deleteUser(userId);
    if (deleteError) throw deleteError;

    return json({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
