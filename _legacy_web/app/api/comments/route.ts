import { asContentLocale, type AppContentLocale } from "../../../../modules/i18n/localeCodes";
import { createServiceSupabase, errorResponse, json, requireUserId } from "../_utils/supabase";
import {
  COMMENT_LOCALES,
  countPostTitleLocales,
  translateCommentBody,
} from "./commentTranslate";

export const runtime = "nodejs";
export const maxDuration = 60;

type CreateCommentPayload = {
  target_type?: "post" | "webinar";
  target_id?: string;
  body?: string;
  source_locale?: string;
};

/**
 * POST /api/comments — create a comment.
 * Single-locale video → store only source language in body_i18n.
 * Multi-locale video → LLM-translate into all other app locales in one call.
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

    if (targetType === "post") {
      const { data: post, error: postError } = await db
        .from("posts")
        .select("id, title, title_i18n, is_published, published_at")
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

      if (localeCount > 1) {
        const fillLocales = COMMENT_LOCALES.filter((l) => l !== sourceLocale);
        try {
          const translated = await translateCommentBody(sourceLocale, body, fillLocales);
          Object.assign(bodyI18n, translated);
        } catch (translateError) {
          // Keep the source comment even if translation fails.
          console.warn("[comments] translate failed", translateError);
        }
      }
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

    return json({ comment: data });
  } catch (error) {
    return errorResponse(error);
  }
}
