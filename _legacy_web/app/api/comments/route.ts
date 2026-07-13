import { after } from "next/server";

import { asContentLocale, type AppContentLocale } from "../_utils/contentLocales";
import { createServiceSupabase, errorResponse, json, requireUserId } from "../_utils/supabase";
import {
  COMMENT_LOCALES,
  countPostTitleLocales,
  translateCommentBody,
} from "./commentTranslate";

export const runtime = "nodejs";
/** Background translate may run after the HTTP response via `after()`. */
export const maxDuration = 60;

type CreateCommentPayload = {
  target_type?: "post" | "webinar";
  target_id?: string;
  body?: string;
  source_locale?: string;
};

/**
 * POST /api/comments — create a comment immediately, then optionally translate
 * other locales in the background (`after`) so the client is not blocked on LLM.
 */
export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const payload = (await req.json()) as CreateCommentPayload;
    const targetType = payload.target_type;
    const targetId = payload.target_id?.trim();
    const body = (payload.body ?? "").trim();
    const sourceLocale = asContentLocale(payload.source_locale) ?? ("ru" as AppContentLocale);

    if (targetType !== "post" && targetType !== "webinar") {
      return json({ error: "target_type must be post or webinar" }, { status: 400 });
    }
    if (!targetId) return json({ error: "target_id обязателен" }, { status: 400 });
    if (!body) return json({ error: "Текст комментария обязателен" }, { status: 400 });
    if (body.length > 2000) {
      return json({ error: "Комментарий слишком длинный (макс. 2000)" }, { status: 400 });
    }

    const db = createServiceSupabase();
    const bodyI18n: Record<string, string> = { [sourceLocale]: body };
    let needsBackgroundTranslate = false;

    if (targetType === "post") {
      const { data: post, error: postError } = await db
        .from("posts")
        .select("id, title, title_i18n, is_published")
        .eq("id", targetId)
        .maybeSingle();
      if (postError) throw postError;
      if (!post || !post.is_published) {
        return json({ error: "Видео не найдено" }, { status: 404 });
      }

      const localeCount = countPostTitleLocales({
        title: post.title,
        title_i18n: (post.title_i18n as Record<string, string> | null) ?? {},
      });
      needsBackgroundTranslate = localeCount > 1;
    }

    const { data, error } = await db
      .from("comments")
      .insert({
        target_type: targetType,
        target_id: targetId,
        user_id: userId,
        body,
        source_locale: sourceLocale,
        body_i18n: bodyI18n,
      })
      .select("id, body, source_locale, body_i18n, created_at")
      .single();
    if (error) throw error;

    // Schedule AFTER building the response payload. Do not await LLM here.
    if (needsBackgroundTranslate && data?.id) {
      const commentId = data.id;
      const fillLocales = COMMENT_LOCALES.filter((l) => l !== sourceLocale);
      after(async () => {
        try {
          const translated = await translateCommentBody(sourceLocale, body, fillLocales);
          if (Object.keys(translated).length === 0) {
            console.warn("[comments] background translate returned empty", commentId);
            return;
          }
          const { error: updateError } = await db
            .from("comments")
            .update({ body_i18n: { ...bodyI18n, ...translated } })
            .eq("id", commentId);
          if (updateError) {
            console.warn("[comments] background translate update failed", updateError.message);
          }
        } catch (translateError) {
          console.warn("[comments] background translate failed", translateError);
        }
      });
    }

    return json({ comment: data });
  } catch (error) {
    return errorResponse(error);
  }
}
