import {
  createServiceSupabase,
  errorResponse,
  json,
  requireUserId,
} from "@legacy/app/api/_utils/supabase";
import {
  AFFIRMATION_SELECT,
  type AffirmationRow,
  serializeAffirmation,
} from "../affirmationShared";

export const runtime = "nodejs";

type Body = {
  /** Local calendar date YYYY-MM-DD in the user's timezone. */
  localDate?: string;
};

/**
 * Bump affirmation day at most once per local calendar day after a successful
 * breath practice completion. Idempotent for the same localDate.
 */
export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const body = (await req.json().catch(() => ({}))) as Body;
    const localDate =
      typeof body.localDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.localDate)
        ? body.localDate
        : null;
    if (!localDate) {
      return json({ error: "Нужна localDate (YYYY-MM-DD)." }, { status: 400 });
    }

    const db = createServiceSupabase();
    const { data: row, error } = await db
      .from("user_affirmations")
      .select(AFFIRMATION_SELECT)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (error) throw error;
    if (!row) {
      return json({ affirmation: null, bumped: false });
    }

    const affirmation = row as AffirmationRow;
    const last = affirmation.last_practiced_at
      ? affirmation.last_practiced_at.slice(0, 10)
      : null;

    // Store last_practiced_at as `${localDate}T12:00:00.000Z` so date slice
    // equals client localDate for idempotency.
    if (last === localDate) {
      return json({
        affirmation: await serializeAffirmation(affirmation),
        bumped: false,
      });
    }

    const nextDay = Math.min(30, Math.max(0, affirmation.current_day) + 1);

    const { data: updated, error: updateError } = await db
      .from("user_affirmations")
      .update({
        current_day: nextDay,
        last_practiced_at: `${localDate}T12:00:00.000Z`,
      })
      .eq("id", affirmation.id)
      .eq("user_id", userId)
      .select(AFFIRMATION_SELECT)
      .single();
    if (updateError) throw updateError;

    return json({
      affirmation: await serializeAffirmation(updated as AffirmationRow),
      bumped: true,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
