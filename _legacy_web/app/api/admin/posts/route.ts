import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../_utils/supabase";
import { postRowFromPayload, type AdminPostPayload } from "./postPayload";

export const runtime = "nodejs";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

type Cursor = { created_at: string; id: string };

function parseLimit(raw: string | null): number {
  const n = Number(raw ?? DEFAULT_PAGE_SIZE);
  if (!Number.isFinite(n)) return DEFAULT_PAGE_SIZE;
  return Math.max(1, Math.min(Math.trunc(n), MAX_PAGE_SIZE));
}

/** Paginated posts (including drafts) with comment counts — infinite scroll in admin UI. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const url = new URL(req.url);
    const limit = parseLimit(url.searchParams.get("limit"));
    const beforeCreatedAt = url.searchParams.get("before_created_at");
    const beforeId = url.searchParams.get("before_id");

    const db = createServiceSupabase();
    // Webinar recordings are edited under /admin/webinars — keep this list for ordinary videos.
    let query = db
      .from("posts")
      .select("*")
      .eq("kind", "video")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);

    if (beforeCreatedAt && beforeId) {
      // Keyset: (created_at, id) < cursor in DESC order. Quote timestamptz for PostgREST.
      query = query.or(
        `created_at.lt."${beforeCreatedAt}",and(created_at.eq."${beforeCreatedAt}",id.lt.${beforeId})`,
      );
    }

    const { data: posts, error } = await query;
    if (error) throw error;

    const rows = posts ?? [];
    const ids = rows.map((p) => p.id);
    const counts = new Map<string, number>();
    if (ids.length > 0) {
      const { data: commentRows, error: commentsError } = await db
        .from("comments")
        .select("target_id")
        .eq("target_type", "post")
        .in("target_id", ids);
      if (commentsError) throw commentsError;
      for (const row of commentRows ?? []) {
        counts.set(row.target_id, (counts.get(row.target_id) ?? 0) + 1);
      }
    }

    const last = rows[rows.length - 1];
    const next_cursor: Cursor | null =
      rows.length >= limit && last
        ? { created_at: last.created_at as string, id: last.id as string }
        : null;

    return json({
      posts: rows.map((p) => ({ ...p, comment_count: counts.get(p.id) ?? 0 })),
      next_cursor,
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
