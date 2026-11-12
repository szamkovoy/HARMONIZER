import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";
import { loadUnsuccessfulPayments } from "../../_utils/unsuccessfulPayments";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Неуспешные: failed, cancelled с renewal/lapsed, pending старше 30 минут. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const lists = await loadUnsuccessfulPayments(createServiceSupabase());
    return json(lists);
  } catch (error) {
    return errorResponse(error);
  }
}
