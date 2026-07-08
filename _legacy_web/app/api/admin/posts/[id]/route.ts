import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";
import { removeStorageObjectsByPublicUrls } from "../../_utils/storageCleanup";
import { postUpdateFromPayload, type AdminPostPayload } from "../postPayload";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/** Публикация + её комментарии (включая скрытые) для модерации. */
export async function GET(req: Request, ctx: RouteContext) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const db = createServiceSupabase();

    const { data: post, error } = await db.from("posts").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!post) return json({ error: "Публикация не найдена" }, { status: 404 });

    const { data: comments, error: commentsError } = await db
      .from("comments")
      .select("id, user_id, body, is_hidden, created_at, users!comments_user_id_fkey(display_name)")
      .eq("target_type", "post")
      .eq("target_id", id)
      .order("created_at", { ascending: true });
    if (commentsError) throw commentsError;

    return json({
      post,
      comments: (comments ?? []).map((c) => {
        const author = c.users as { display_name?: string | null } | null;
        return {
          id: c.id,
          user_id: c.user_id,
          body: c.body,
          is_hidden: c.is_hidden,
          created_at: c.created_at,
          display_name: author?.display_name?.trim() || "Гость",
        };
      }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(req: Request, ctx: RouteContext) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const payload = (await req.json()) as AdminPostPayload;
    const db = createServiceSupabase();

    const { data: current, error: readError } = await db
      .from("posts")
      .select("published_at")
      .eq("id", id)
      .maybeSingle();
    if (readError) throw readError;
    if (!current) return json({ error: "Публикация не найдена" }, { status: 404 });

    const update = postUpdateFromPayload(payload, current);
    const { data, error } = await db.from("posts").update(update).eq("id", id).select("*").single();
    if (error) throw error;
    return json({ post: data });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Удаляет публикацию, её комментарии (полиморфная связь — без FK) и обложку. */
export async function DELETE(req: Request, ctx: RouteContext) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const db = createServiceSupabase();

    const { data: post, error: readError } = await db
      .from("posts")
      .select("cover_url")
      .eq("id", id)
      .maybeSingle();
    if (readError) throw readError;
    if (!post) return json({ error: "Публикация не найдена" }, { status: 404 });

    const { error: commentsError } = await db
      .from("comments")
      .delete()
      .eq("target_type", "post")
      .eq("target_id", id);
    if (commentsError) throw commentsError;

    const { error } = await db.from("posts").delete().eq("id", id);
    if (error) throw error;

    await removeStorageObjectsByPublicUrls(db, "post-covers", [post.cover_url]);
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
