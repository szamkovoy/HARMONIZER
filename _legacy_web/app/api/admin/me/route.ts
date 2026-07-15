import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../_utils/supabase";

export const runtime = "nodejs";

/** Проверка «я админ» для гейта UI. 200 → admin, 401/403 → нет. */
export async function GET(req: Request) {
  try {
    const userId = await requireAdmin(req);
    const db = createServiceSupabase();
    const [{ data }, unprocessed] = await Promise.all([
      db.from("users").select("display_name").eq("id", userId).maybeSingle(),
      db
        .from("support_messages")
        .select("id", { count: "exact", head: true })
        .is("processed_at", null),
    ]);
    return json({
      userId,
      displayName: data?.display_name ?? null,
      unprocessedSupportCount: unprocessed.count ?? 0,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
