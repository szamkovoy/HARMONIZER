import { createServiceSupabase, errorResponse, json, requireUser } from "../../_utils/supabase";
import { wipeUserAccount } from "../wipeUserAccount";

/**
 * DELETE /api/account/delete — удаление аккаунта из приложения (Bearer JWT).
 * Делегирует в wipeUserAccount (cancel шлюзов → buyer_email → deleteUser).
 *
 * Email берём из user JWT (requireUser), не из auth.admin.getUserById —
 * Admin API с `sb_secret_*` ключами периодически отвечает bad_jwt/ES256.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function DELETE(req: Request) {
  try {
    const { id: userId, email } = await requireUser(req);
    if (!email) {
      return json({ error: "User has no email" }, { status: 409 });
    }

    const db = createServiceSupabase();
    const { data: flags, error: flagError } = await db
      .from("users")
      .select("store_review_account")
      .eq("id", userId)
      .maybeSingle();
    if (flagError) throw flagError;
    if (flags?.store_review_account) {
      return json({ error: "Store review account cannot be deleted" }, { status: 403 });
    }

    await wipeUserAccount(db, { userId, email });
    return json({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
