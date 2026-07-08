// @ts-nocheck
import { assertCronSecret, createServiceClient, isOptions, json } from "../_shared/supabase.ts";

const BATCH_LIMIT = 100;
const MAX_BATCHES = 10;
const STORAGE_MARKER = "/storage/v1/object/public/story-media/";

function toStoragePath(url: string | null | undefined): string | null {
  if (!url || !url.includes(STORAGE_MARKER)) return null;
  return decodeURIComponent(url.split(STORAGE_MARKER)[1] ?? "").split("?")[0] || null;
}

Deno.serve(async (req) => {
  if (isOptions(req)) return new Response("ok");
  const unauthorized = assertCronSecret(req);
  if (unauthorized) return unauthorized;

  try {
    const db = createServiceClient();
    let deletedCount = 0;
    let batchCount = 0;

    while (batchCount < MAX_BATCHES) {
      const now = new Date().toISOString();
      const { data: stories, error: readError } = await db
        .from("stories")
        .select("id, image_url, video_url, cover_url, thumbnail_url")
        .eq("is_published", true)
        .eq("is_evergreen", false)
        .lt("expires_at", now)
        .order("expires_at", { ascending: true })
        .limit(BATCH_LIMIT);
      if (readError) throw readError;
      if (!stories?.length) break;

      const ids = stories.map((story) => story.id);
      const { error: deleteError } = await db.from("stories").delete().in("id", ids);
      if (deleteError) throw deleteError;

      const storagePaths = stories
        .flatMap((story) => [story.image_url, story.video_url, story.cover_url, story.thumbnail_url])
        .map(toStoragePath)
        .filter(Boolean);
      if (storagePaths.length > 0) {
        const { error: removeError } = await db.storage.from("story-media").remove(storagePaths);
        if (removeError) console.error("[cleanup-expired-stories] storage cleanup failed", removeError.message);
      }

      deletedCount += stories.length;
      batchCount += 1;
      if (stories.length < BATCH_LIMIT) break;
    }

    return json({ ok: true, deletedCount, batches: batchCount });
  } catch (error) {
    console.error("[cleanup-expired-stories]", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
});
