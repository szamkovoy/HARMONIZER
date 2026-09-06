import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../../_utils/supabase";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const REVIEW_STATUSES = new Set(["unreviewed", "reviewed_ok", "issue", "fixed"]);

/** QA journal for one user's daily dialogs (7-day retention). Newest last. */
export async function GET(req: Request, ctx: RouteContext) {
  try {
    await requireAdmin(req);
    const { id: userId } = await ctx.params;
    const db = createServiceSupabase();
    const { data: user, error: userError } = await db
      .from("users")
      .select("id, display_name, locale")
      .eq("id", userId)
      .maybeSingle();
    if (userError) throw userError;
    if (!user) return json({ error: "User not found" }, { status: 404 });

    const { data, error } = await db
      .from("daily_dialog_archives")
      .select(
        "id, conversation_id, entry_source, day_tab_mode, locale, algo_version, outcome, started_at, updated_at, closed_at, turns, last_branch, last_turn_mode, last_should_close, review_status, reviewed_at, review_note",
      )
      .eq("user_id", userId)
      .order("started_at", { ascending: true });
    if (error) throw error;

    return json({
      user: { id: user.id, display_name: user.display_name, locale: user.locale },
      dialogs: data ?? [],
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Mark a dialog as reviewed / issue / fixed. Body: { archiveId, review_status, review_note? }. */
export async function PATCH(req: Request, ctx: RouteContext) {
  try {
    await requireAdmin(req);
    const { id: userId } = await ctx.params;
    const payload = (await req.json()) as {
      archiveId?: string;
      review_status?: string;
      review_note?: string | null;
    };
    const archiveId = typeof payload.archiveId === "string" ? payload.archiveId.trim() : "";
    const reviewStatus = typeof payload.review_status === "string" ? payload.review_status.trim() : "";
    if (!archiveId || !REVIEW_STATUSES.has(reviewStatus)) {
      return json({ error: "archiveId и review_status обязательны" }, { status: 400 });
    }
    const note =
      payload.review_note === undefined
        ? undefined
        : payload.review_note == null
          ? null
          : String(payload.review_note).slice(0, 2000);
    const db = createServiceSupabase();
    const { data, error } = await db
      .from("daily_dialog_archives")
      .update({
        review_status: reviewStatus,
        reviewed_at: reviewStatus === "unreviewed" ? null : new Date().toISOString(),
        ...(note !== undefined ? { review_note: note } : {}),
      })
      .eq("id", archiveId)
      .eq("user_id", userId)
      .select("id, review_status, reviewed_at, review_note")
      .maybeSingle();
    if (error) throw error;
    if (!data) return json({ error: "Archive not found" }, { status: 404 });
    return json({ archive: data });
  } catch (error) {
    return errorResponse(error);
  }
}
