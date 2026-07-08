import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../_utils/supabase";
import { postRowFromPayload, type AdminPostPayload } from "./postPayload";

export const runtime = "nodejs";

/** Все публикации (включая черновики) со счётчиком комментариев. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const db = createServiceSupabase();
    const { data: posts, error } = await db
      .from("posts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;

    const ids = (posts ?? []).map((p) => p.id);
    const counts = new Map<string, number>();
    if (ids.length > 0) {
      const { data: rows, error: commentsError } = await db
        .from("comments")
        .select("target_id")
        .eq("target_type", "post")
        .in("target_id", ids);
      if (commentsError) throw commentsError;
      for (const row of rows ?? []) {
        counts.set(row.target_id, (counts.get(row.target_id) ?? 0) + 1);
      }
    }
    return json({
      posts: (posts ?? []).map((p) => ({ ...p, comment_count: counts.get(p.id) ?? 0 })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireAdmin(req);
    const payload = (await req.json()) as AdminPostPayload;
    const row = { ...postRowFromPayload(payload), created_by: userId };
    const { data, error } = await createServiceSupabase()
      .from("posts")
      .insert(row)
      .select("*")
      .single();
    if (error) throw error;
    return json({ post: data });
  } catch (error) {
    return errorResponse(error);
  }
}
