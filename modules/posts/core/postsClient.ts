import { getSupabase } from "@/services/supabase";

export type PostItem = {
  id: string;
  title: string;
  body: string;
  coverUrl: string | null;
  publishedAt: string | null;
  commentCount: number;
};

export type CommentTargetType = "post" | "webinar";

export type CommentItem = {
  id: string;
  userId: string;
  /** null → клиент подставляет локализованный фолбэк (posts.comments.anonymous). */
  displayName: string | null;
  body: string;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
  isMine: boolean;
};

export async function fetchPostsFeed(limit = 50): Promise<PostItem[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("get_posts_feed", { p_limit: limit });
  if (error) {
    if (__DEV__) console.warn("[posts] feed load failed", error.message);
    return [];
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body ?? "",
    coverUrl: row.cover_url ?? null,
    publishedAt: row.published_at ?? null,
    commentCount: Number(row.comment_count ?? 0),
  }));
}

export async function fetchLatestPost(): Promise<PostItem | null> {
  const posts = await fetchPostsFeed(1);
  return posts[0] ?? null;
}

export async function fetchComments(
  targetType: CommentTargetType,
  targetId: string,
  userId: string,
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
  return (data ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    displayName: row.display_name ?? null,
    body: row.body,
    createdAt: row.created_at,
    likeCount: Number(row.like_count ?? 0),
    likedByMe: row.liked_by_me ?? false,
    isMine: row.is_mine ?? false,
  }));
}

export async function addComment(
  targetType: CommentTargetType,
  targetId: string,
  userId: string,
  body: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, message: "offline" };
  const { error } = await supabase.from("comments").insert({
    target_type: targetType,
    target_id: targetId,
    user_id: userId,
    body: body.trim(),
  });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function deleteOwnComment(commentId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const { error } = await supabase.from("comments").delete().eq("id", commentId);
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
