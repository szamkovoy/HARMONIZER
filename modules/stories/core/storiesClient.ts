import { Image } from "react-native";

import { getSupabase } from "@/services/supabase";

export type StoryItem = {
  id: string;
  kind: "image" | "video" | "video_cover";
  imageUrl: string | null;
  coverUrl: string | null;
  thumbnailUrl: string | null;
  videoUrl: string | null;
  captionText: string | null;
  publishAt: string | null;
  expiresAt: string | null;
  isViewed: boolean;
};

type WarmFeedSnapshot = {
  userId: string;
  items: StoryItem[];
  fetchedAt: number;
};

const WARM_FEED_TTL_MS = 60_000;

let warmFeedSnapshot: WarmFeedSnapshot | null = null;
let warmFeedPromise: Promise<StoryItem[]> | null = null;
let warmFeedUserId: string | null = null;
let sessionThumbUserId: string | null = null;
let sessionThumbUrl: string | null = null;

function captionTextFrom(caption: unknown): string | null {
  if (caption && typeof caption === "object" && "text" in caption) {
    const text = (caption as { text?: unknown }).text;
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  return null;
}

function normalizeStory(row: {
  id: string;
  kind: string;
  image_url: string | null;
  cover_url: string | null;
  thumbnail_url: string | null;
  video_url: string | null;
  caption: unknown;
  publish_at: string | null;
  expires_at: string | null;
  is_viewed: boolean | null;
}): StoryItem {
  return {
    id: row.id,
    kind: (row.kind === "video" || row.kind === "video_cover" ? row.kind : "image") as StoryItem["kind"],
    imageUrl: row.image_url ?? null,
    coverUrl: row.cover_url ?? null,
    thumbnailUrl: row.thumbnail_url ?? null,
    videoUrl: row.video_url ?? null,
    captionText: captionTextFrom(row.caption),
    publishAt: row.publish_at ?? null,
    expiresAt: row.expires_at ?? null,
    isViewed: row.is_viewed ?? false,
  };
}

function isPlayableStory(story: StoryItem): boolean {
  return story.kind === "image" ? !!story.imageUrl : !!(story.videoUrl || story.coverUrl || story.imageUrl);
}

function storyAvatarThumb(items: StoryItem[]): string | null {
  const latest = items[items.length - 1];
  if (!latest) return null;
  return latest.thumbnailUrl ?? latest.coverUrl ?? latest.imageUrl ?? latest.videoUrl ?? null;
}

function isMissingStoryFeedRpc(error: { message?: string; code?: string }): boolean {
  const message = error.message ?? "";
  return (
    error.code === "PGRST202" ||
    /get_story_feed/i.test(message) ||
    /Could not find the function/i.test(message)
  );
}

export function storyMediaUri(story: StoryItem): string | null {
  if (story.kind === "image") return story.imageUrl;
  if (story.kind === "video") return story.videoUrl ?? story.coverUrl ?? story.imageUrl;
  return story.coverUrl ?? story.imageUrl ?? story.videoUrl;
}

async function fetchStoryFeedDirect(userId: string): Promise<StoryItem[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();

  const { data: rows, error } = await supabase
    .from("stories")
    .select("id, kind, image_url, cover_url, thumbnail_url, video_url, caption, publish_at, expires_at, is_evergreen")
    .eq("is_published", true)
    .lte("publish_at", nowIso)
    .order("order_hint", { ascending: true })
    .order("publish_at", { ascending: true });
  if (error) throw error;

  const { data: views, error: viewsError } = await supabase
    .from("user_story_views")
    .select("story_id")
    .eq("user_id", userId);
  if (viewsError) throw viewsError;

  const viewedIds = new Set((views ?? []).map((row) => row.story_id));

  return (rows ?? [])
    .filter(
      (row) =>
        row.is_evergreen === true ||
        !row.expires_at ||
        new Date(row.expires_at).getTime() > nowMs,
    )
    .map((row) =>
      normalizeStory({
        ...row,
        is_viewed: viewedIds.has(row.id),
      }),
    )
    .filter(isPlayableStory);
}

async function fetchStoryFeedFromRpc(userId: string): Promise<StoryItem[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("get_story_feed", { p_user_id: userId });
  if (error) {
    if (isMissingStoryFeedRpc(error)) {
      if (__DEV__) {
        console.warn("[stories] get_story_feed missing, using direct stories query fallback");
      }
      return fetchStoryFeedDirect(userId);
    }
    if (__DEV__) console.warn("[stories] feed fetch failed", error.message);
    return [];
  }
  return (data ?? []).map(normalizeStory).filter(isPlayableStory);
}

async function rememberSessionThumb(userId: string, items: StoryItem[]): Promise<void> {
  if (sessionThumbUserId === userId && sessionThumbUrl) return;
  const nextThumb = storyAvatarThumb(items);
  if (!nextThumb) return;
  sessionThumbUserId = userId;
  sessionThumbUrl = nextThumb;
  try {
    await Image.prefetch(nextThumb);
  } catch {
    // Best effort only; rendering still works without a completed prefetch.
  }
}

function saveWarmFeed(userId: string, items: StoryItem[]): StoryItem[] {
  if (items.length > 0) {
    warmFeedSnapshot = { userId, items, fetchedAt: Date.now() };
    void rememberSessionThumb(userId, items);
  }
  return items;
}

function readWarmFeed(userId: string): StoryItem[] | null {
  if (!warmFeedSnapshot || warmFeedSnapshot.userId !== userId) return null;
  if (Date.now() - warmFeedSnapshot.fetchedAt > WARM_FEED_TTL_MS) return null;
  return warmFeedSnapshot.items;
}

export function getSessionStoryAvatarThumb(userId: string): string | null {
  return sessionThumbUserId === userId ? sessionThumbUrl : null;
}

export async function primeStoryFeedSession(userId: string): Promise<void> {
  if (readWarmFeed(userId)) return;
  if (warmFeedPromise && warmFeedUserId === userId) {
    await warmFeedPromise;
    return;
  }
  warmFeedUserId = userId;
  warmFeedPromise = fetchStoryFeedFromRpc(userId).then((items) => saveWarmFeed(userId, items));
  try {
    await warmFeedPromise;
  } finally {
    warmFeedPromise = null;
    warmFeedUserId = null;
  }
}

export async function fetchStoryFeed(userId: string, options?: { preferWarmCache?: boolean }): Promise<StoryItem[]> {
  if (options?.preferWarmCache !== false) {
    const warm = readWarmFeed(userId);
    if (warm) return warm;
  }
  return saveWarmFeed(userId, await fetchStoryFeedFromRpc(userId));
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
