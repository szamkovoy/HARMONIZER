import { createServiceSupabase, errorResponse, json, requireUserId } from "../../../_utils/supabase";
import { getActiveBookPurchase } from "../../bookOwnership";

/**
 * Book ownership for the in-app reader (Phase B).
 * GET /api/account/purchases/book
 *   -> { owned: boolean, contractId?: string, purchasedAt?: string }
 */
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const userId = await requireUserId(req);
    const db = createServiceSupabase();
    const row = await getActiveBookPurchase(db, userId);
    if (!row) return json({ owned: false });
    return json({
      owned: true,
      contractId: row.contractId,
      purchasedAt: row.purchasedAt,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
