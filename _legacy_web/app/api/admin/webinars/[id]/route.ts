import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";
import { emailsByUserId } from "../../_utils/authEmails";
import { webinarUpdateFromPayload, type AdminWebinarPayload } from "../webinarPayload";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Вебинар + вопросы (включая скрытые, с голосами, по убыванию голосов)
 * + список записавшихся (имя, email, тариф).
 */
export async function GET(req: Request, ctx: RouteContext) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const db = createServiceSupabase();

    const { data: webinar, error } = await db.from("webinars").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!webinar) return json({ error: "Вебинар не найден" }, { status: 404 });

    const [questionsRes, regsRes] = await Promise.all([
      db
        .from("comments")
        .select("id, user_id, body, is_hidden, created_at, users!comments_user_id_fkey(display_name)")
        .eq("target_type", "webinar")
        .eq("target_id", id)
        .order("created_at", { ascending: true }),
      db
        .from("webinar_registrations")
        .select("user_id, created_at, users(display_name, membership_tier)")
        .eq("webinar_id", id)
        .order("created_at", { ascending: true }),
    ]);
    if (questionsRes.error) throw questionsRes.error;
    if (regsRes.error) throw regsRes.error;

    const emails = await emailsByUserId(
      db,
      (regsRes.data ?? []).map((r) => r.user_id),
    );

    const questionIds = (questionsRes.data ?? []).map((q) => q.id);
    const votes = new Map<string, number>();
    if (questionIds.length > 0) {
      const { data: likeRows, error: likesError } = await db
        .from("comment_likes")
        .select("comment_id")
        .in("comment_id", questionIds);
      if (likesError) throw likesError;
      for (const row of likeRows ?? []) {
        votes.set(row.comment_id, (votes.get(row.comment_id) ?? 0) + 1);
      }
    }

    const questions = (questionsRes.data ?? [])
      .map((q) => {
        const author = q.users as { display_name?: string | null } | null;
        return {
          id: q.id,
          user_id: q.user_id,
          body: q.body,
          is_hidden: q.is_hidden,
          created_at: q.created_at,
          display_name: author?.display_name?.trim() || "Гость",
          vote_count: votes.get(q.id) ?? 0,
        };
      })
      .sort((a, b) => b.vote_count - a.vote_count || a.created_at.localeCompare(b.created_at));

    return json({
      webinar,
      questions,
      registrations: (regsRes.data ?? []).map((r) => {
        const user = r.users as {
          display_name?: string | null;
          membership_tier?: string | null;
        } | null;
        return {
          user_id: r.user_id,
          created_at: r.created_at,
          display_name: user?.display_name?.trim() || "—",
          email: emails.get(r.user_id) ?? "—",
          membership_tier: user?.membership_tier ?? "free",
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
    const payload = (await req.json()) as AdminWebinarPayload;
    const update = webinarUpdateFromPayload(payload);
    const { data, error } = await createServiceSupabase()
      .from("webinars")
      .update(update)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return json({ webinar: data });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Удаляет вебинар, его вопросы (полиморфная связь — без FK) и регистрации (FK cascade). */
export async function DELETE(req: Request, ctx: RouteContext) {
  try {
    await requireAdmin(req);
    const { id } = await ctx.params;
    const db = createServiceSupabase();

    const { error: questionsError } = await db
      .from("comments")
      .delete()
      .eq("target_type", "webinar")
      .eq("target_id", id);
    if (questionsError) throw questionsError;

    const { error } = await db.from("webinars").delete().eq("id", id);
    if (error) throw error;
    return json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
