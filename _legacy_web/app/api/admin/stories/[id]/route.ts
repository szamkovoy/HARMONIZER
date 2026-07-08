import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";
import { removeStorageObjectsByPublicUrls } from "../../_utils/storageCleanup";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

type StoryUpdatePayload = {
  caption?: string;
  publish_at?: string;
  expires_at?: string | null;
  is_evergreen?: boolean;
  is_published?: boolean;
  order_hint?: number;
};

/** Частичное обновление: публикация/снятие, подпись, сроки, порядок. */
export async function PATCH(req: Request, ctx: RouteContext) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const body = (await req.json()) as StoryUpdatePayload;

    const update: Record<string, unknown> = {};
    if (body.caption !== undefined) update.caption = body.caption.trim() ? { text: body.caption.trim() } : {};
    if (body.publish_at !== undefined) update.publish_at = new Date(body.publish_at).toISOString();
    if (body.expires_at !== undefined) {
      update.expires_at = body.expires_at ? new Date(body.expires_at).toISOString() : null;
    }
    if (body.is_evergreen !== undefined) update.is_evergreen = body.is_evergreen;
    if (body.is_published !== undefined) update.is_published = body.is_published;
    if (body.order_hint !== undefined) update.order_hint = body.order_hint;
    if (Object.keys(update).length === 0) {
      return json({ error: "Нет полей для обновления" }, { status: 400 });
    }

    const { data, error } = await createServiceSupabase()
      .from("stories")
      .update(update)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return json({ story: data });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Удаляет сторис и её файлы в story-media (просмотры каскадом по FK). */
export async function DELETE(req: Request, ctx: RouteContext) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const db = createServiceSupabase();

    const { data: story, error: readError } = await db
      .from("stories")
      .select("image_url, video_url, cover_url, thumbnail_url")
      .eq("id", id)
      .maybeSingle();
    if (readError) throw readError;
    if (!story) return json({ error: "Сторис не найдена" }, { status: 404 });

    const { error } = await db.from("stories").delete().eq("id", id);
    if (error) throw error;

    await removeStorageObjectsByPublicUrls(db, "story-media", [
      story.image_url,
      story.video_url,
      story.cover_url,
      story.thumbnail_url,
    ]);

    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
