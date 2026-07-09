import type { SupabaseClient } from "@supabase/supabase-js";

import { removeStorageObjectsByPublicUrls } from "../_utils/storageCleanup";
 
const BATCH_LIMIT = 100;
const MAX_BATCHES = 10;

export async function cleanupExpiredStories(db: SupabaseClient): Promise<{ deletedCount: number; batches: number }> {
  let deletedCount = 0;
  let batchCount = 0;

  while (batchCount < MAX_BATCHES) {
    const { data: stories, error: readError } = await db
      .from("stories")
      .select("id, image_url, video_url, cover_url, thumbnail_url")
      .eq("is_published", true)
      .eq("is_evergreen", false)
      .lt("expires_at", new Date().toISOString())
      .order("expires_at", { ascending: true })
      .limit(BATCH_LIMIT);
    if (readError) throw readError;
    if (!stories?.length) break;

    const ids = stories.map((story) => story.id);
    const { error: deleteError } = await db.from("stories").delete().in("id", ids);
    if (deleteError) throw deleteError;

    await removeStorageObjectsByPublicUrls(
      db,
      "story-media",
      stories.flatMap((story) => [story.image_url, story.video_url, story.cover_url, story.thumbnail_url]),
    );

    deletedCount += stories.length;
    batchCount += 1;
    if (stories.length < BATCH_LIMIT) break;
  }

  return { deletedCount, batches: batchCount };
}
