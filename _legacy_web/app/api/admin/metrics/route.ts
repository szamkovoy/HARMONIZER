import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../_utils/supabase";

export const runtime = "nodejs";

/** Дашборд: все агрегаты считает RPC admin_dashboard_metrics в БД. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const { data, error } = await createServiceSupabase().rpc("admin_dashboard_metrics");
    if (error) throw error;
    return json({ metrics: data });
  } catch (error) {
    return errorResponse(error);
  }
}
