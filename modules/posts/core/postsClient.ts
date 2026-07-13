import {
  asContentLocale,
  parseStringRecord,
  type AppContentLocale,
} from "@/modules/i18n";
import {
  postAvailableInLocale,
  resolvePostContentForLocale,
} from "@/modules/posts/core/postLocale";
import { getCommunicatorApiBaseUrl } from "@/services/communicatorConfig";
import { getSupabase } from "@/services/supabase";

export type PostContentSource = {
  title: string;
  body: string;
  coverUrl: string | null;
  titleI18n: Record<string, string>;
  bodyI18n: Record<string, string>;
  coverUrlI18n: Record<string, string>;
};

export type PostItem = PostContentSource & {
  id: string;
  publishedAt: string | null;
  commentCount: number;
};

/** @deprecated Prefer resolvePostContentForLocale — returns null when locale has no authored content. */
export function resolvePostContent(source: PostContentSource, locale: AppContentLocale): {
  title: string;
  body: string;
  coverUrl: string | null;
} {
  return (
    resolvePostContentForLocale(source, locale) ?? {
      title: "",
      body: "",
      coverUrl: null,
    }
  );
}

export { postAvailableInLocale, resolvePostContentForLocale };

export type CommentTargetType = "post" | "webinar";

export type CommentItem = {
  id: string;
  userId: string;
  /** null → клиент подставляет локализованный фолбэк (posts.comments.anonymous). */
  displayName: string | null;
  /** Resolved body for the active UI locale. */
  body: string;
  sourceLocale: AppContentLocale | null;
  bodyI18n: Record<string, string>;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
  isMine: boolean;
};

/** ~2–3 lines on a phone card; length floats to the last whole word. */
export const POST_CARD_PREVIEW_CHARS = 160;

export function truncatePostPreview(text: string, maxChars = POST_CARD_PREVIEW_CHARS): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;

  // Prefer a break at whitespace so we never clip mid-word.
  const slice = normalized.slice(0, maxChars + 1);
  const breakAt = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("\u00a0"));
  const clipped =
    breakAt >= Math.floor(maxChars * 0.45)
      ? normalized.slice(0, breakAt)
      : normalized.slice(0, maxChars).replace(/\S+$/u, "").trimEnd() || normalized.slice(0, maxChars);
  return `${clipped.trimEnd()}…`;
}

export function resolveCommentBodyForLocale(
  source: { body: string; sourceLocale: AppContentLocale | null; bodyI18n: Record<string, string> },
  locale: AppContentLocale,
): string {
  const localized = (source.bodyI18n[locale] ?? "").trim();
  if (localized) return localized;
  return source.body;
}

function normalizePostRow(row: {
  id: string;
  title: string;
  body: string | null;
  cover_url: string | null;
  title_i18n?: unknown;
  body_i18n?: unknown;
  cover_url_i18n?: unknown;
  published_at: string | null;
  comment_count?: number | null;
}): PostItem {
  return {
    id: row.id,
    title: row.title,
    body: row.body ?? "",
    coverUrl: row.cover_url ?? null,
    titleI18n: parseStringRecord(row.title_i18n),
    bodyI18n: parseStringRecord(row.body_i18n),
    coverUrlI18n: parseStringRecord(row.cover_url_i18n),
    publishedAt: row.published_at ?? null,
    commentCount: Number(row.comment_count ?? 0),
  };
}

export async function fetchPostsFeed(limit = 50): Promise<PostItem[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("get_posts_feed", { p_limit: limit });
  if (error) {
    if (__DEV__) console.warn("[posts] feed load failed", error.message);
    return [];
  }
  return (data ?? []).map(normalizePostRow);
}

/** Feed filtered to videos authored for the active UI locale. */
export async function fetchPostsFeedForLocale(locale: AppContentLocale, limit = 50): Promise<PostItem[]> {
  const posts = await fetchPostsFeed(limit);
  return posts.filter((post) => postAvailableInLocale(post, locale));
}

export async function fetchLatestPost(): Promise<PostItem | null> {
  const posts = await fetchPostsFeed(1);
  return posts[0] ?? null;
}

export async function fetchLatestPostForLocale(locale: AppContentLocale): Promise<PostItem | null> {
  const posts = await fetchPostsFeed(20);
  return posts.find((post) => postAvailableInLocale(post, locale)) ?? null;
}

/** Newest video for locale that the user has not opened yet (home card). */
export async function fetchLatestUnviewedPostForLocale(
  locale: AppContentLocale,
  userId: string | null,
): Promise<PostItem | null> {
  const latest = await fetchLatestPostForLocale(locale);
  if (!latest) return null;
  if (!userId) return latest;
  const viewed = await hasViewedPost(userId, latest.id);
  return viewed ? null : latest;
}

export async function hasViewedPost(userId: string, postId: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { data, error } = await supabase
    .from("user_post_views")
    .select("post_id")
    .eq("user_id", userId)
    .eq("post_id", postId)
    .maybeSingle();
  if (error) {
    if (__DEV__) console.warn("[posts] view check failed", error.message);
    return false;
  }
  return Boolean(data);
}

export async function markPostViewed(userId: string, postId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from("user_post_views").upsert(
    { user_id: userId, post_id: postId, viewed_at: new Date().toISOString() },
    { onConflict: "user_id,post_id" },
  );
  if (error && __DEV__) console.warn("[posts] mark viewed failed", error.message);
}

export async function fetchPostById(id: string): Promise<PostItem | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("posts")
    .select("id, title, body, cover_url, title_i18n, body_i18n, cover_url_i18n, published_at")
    .eq("id", id)
    .eq("is_published", true)
    .lte("published_at", new Date().toISOString())
    .maybeSingle();
  if (error) {
    if (__DEV__) console.warn("[posts] post load failed", error.message);
    return null;
  }
  if (!data) return null;
  return normalizePostRow({
    id: data.id,
    title: data.title,
    body: data.body,
    cover_url: data.cover_url,
    title_i18n: data.title_i18n,
    body_i18n: data.body_i18n,
    cover_url_i18n: data.cover_url_i18n,
    published_at: data.published_at,
    comment_count: 0,
  });
}

export async function fetchComments(
  targetType: CommentTargetType,
  targetId: string,
  userId: string,
  locale: AppContentLocale,
): Promise<CommentItem[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("get_target_comments", {
    p_target_type: targetType,
    p_target_id: targetId,
    p_user_id: userId,
  });
  if (error) {
    if (__DEV__) console.warn("[posts] comments load failed", error.message);
    return [];
  }
  return (data ?? []).map((row) => {
    const bodyI18n = parseStringRecord(row.body_i18n);
    const sourceLocale = asContentLocale(row.source_locale);
    const raw = {
      body: row.body,
      sourceLocale,
      bodyI18n,
    };
    return {
      id: row.id,
      userId: row.user_id,
      displayName: row.display_name ?? null,
      body: resolveCommentBodyForLocale(raw, locale),
      sourceLocale,
      bodyI18n,
      createdAt: row.created_at,
      likeCount: Number(row.like_count ?? 0),
      likedByMe: row.liked_by_me ?? false,
      isMine: row.is_mine ?? false,
    };
  });
}

export async function addComment(
  targetType: CommentTargetType,
  targetId: string,
  userId: string,
  body: string,
  sourceLocale: AppContentLocale,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, message: "offline" };

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return { ok: false, message: "unauthorized" };

    const res = await fetch(`${getCommunicatorApiBaseUrl()}/api/comments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        target_type: targetType,
        target_id: targetId,
        body: body.trim(),
        source_locale: sourceLocale,
      }),
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, message: payload?.error ?? `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (error) {
    if (__DEV__) console.warn("[posts] comment create failed", error);
    // Fallback: direct insert without translation (offline / API down).
    const { error: insertError } = await supabase.from("comments").insert({
      target_type: targetType,
      target_id: targetId,
      user_id: userId,
      body: body.trim(),
      source_locale: sourceLocale,
      body_i18n: { [sourceLocale]: body.trim() },
    });
    if (insertError) return { ok: false, message: insertError.message };
    return { ok: true };
  }
}

export async function deleteOwnComment(commentId: string, userId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from("comments").delete().eq("id", commentId).eq("user_id", userId);
  if (error && __DEV__) console.warn("[posts] comment delete failed", error.message);
}

export async function setCommentLike(commentId: string, userId: string, liked: boolean): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = liked
    ? (await supabase.from("comment_likes").upsert(
        { comment_id: commentId, user_id: userId },
        { onConflict: "comment_id,user_id", ignoreDuplicates: true },
      ))
    : (await supabase.from("comment_likes").delete().eq("comment_id", commentId).eq("user_id", userId));
  if (error && __DEV__) console.warn("[posts] like toggle failed", error.message);
}
