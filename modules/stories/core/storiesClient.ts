import { getSupabase } from "@/services/supabase";

/**
 * Клиентский слой сторис автора (модуль author_presence).
 * Данные — RPC get_user_stories (только непросмотренные: свежие, либо до 3
 * последних истёкших при паузе в публикациях >3 дней). Просмотры пишутся в
 * user_story_views под RLS «только своё».
 */
export type StoryItem = {
  id: string;
  kind: "image" | "video" | "video_cover";
  imageUrl: string | null;
  coverUrl: string | null;
  videoUrl: string | null;
  captionText: string | null;
  isFresh: boolean;
};

function captionTextFrom(caption: unknown): string | null {
  if (caption && typeof caption === "object" && "text" in caption) {
    const text = (caption as { text?: unknown }).text;
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  return null;
}

export async function fetchUserStories(userId: string): Promise<StoryItem[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("get_user_stories", { p_user_id: userId });
  if (error) {
    if (__DEV__) console.warn("[stories] fetch failed", error.message);
    return [];
  }
  return (data ?? [])
    .map((row) => ({
      id: row.id,
      kind: (row.kind === "video" || row.kind === "video_cover" ? row.kind : "image") as StoryItem["kind"],
      imageUrl: row.image_url ?? null,
      coverUrl: row.cover_url ?? null,
      videoUrl: row.video_url ?? null,
      captionText: captionTextFrom(row.caption),
      isFresh: row.is_fresh ?? true,
    }))
    .filter((story) => (story.kind === "image" ? !!story.imageUrl : !!(story.videoUrl || story.coverUrl)));
}

/** Идемпотентно фиксирует просмотр; completed=true при досмотре до конца. */
export async function markStoryViewed(userId: string, storyId: string, completed: boolean): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase
    .from("user_story_views")
    .upsert(
      { user_id: userId, story_id: storyId, completed, viewed_at: new Date().toISOString() },
      { onConflict: "user_id,story_id" },
    );
  if (error && __DEV__) console.warn("[stories] mark viewed failed", error.message);
}
