import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";
import { cleanupExpiredStories } from "../cleanupExpiredStories";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const db = createServiceSupabase();
    const { deletedCount, batches } = await cleanupExpiredStories(db);
    return json({ ok: true, deletedCount, batches });
  } catch (error) {
    return errorResponse(error);
  }
}
