import {
  createServiceSupabase,
  errorResponse,
  json,
  requireUserId,
} from "@legacy/app/api/_utils/supabase";
import {
  type AffirmationRow,
  serializeAffirmation,
} from "../route";

export const runtime = "nodejs";

const SELECT =
  "id, user_id, text, audio_url, status, current_day, last_practiced_at, cycle_started_at, created_at, updated_at";

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
      .select(SELECT)
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

    // Compare against UTC date of last_practiced_at is imperfect; client sends localDate
    // and we also store a marker. Prefer matching localDate stored in a side field via
    // comparing ISO date of last practice when client consistently sends localDate.
    // We store last_practiced_at as now() and also check if current_day already reflects today
    // by comparing the date portion of last_practiced_at in the client's localDate string
    // that we persist indirectly: if last_practiced_at's calendar day equals today in
    // a "localDate" sense we use a dedicated check — client sends localDate every time,
    // and we store an ISO timestamp; for idempotency we compare a date-only stamp
    // encoded by checking whether last_practiced_at date (UTC) matches — better:
    // store last practice local date by comparing against provided localDate using
    // a text marker in a comment. Simplest reliable approach: if last_practiced_at
    // exists and its YYYY-MM-DD (from a client-provided previous call) — we keep
    // `last_practiced_local_date`... but schema doesn't have it.
    //
    // Practical approach without schema change: client sends localDate; we bump only if
    // last_practiced_at is null OR the absolute time difference from "start of localDate"
    // is ambiguous. Store last_practiced_at as `${localDate}T12:00:00.000Z` so date slice
    // equals localDate for idempotency.

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
        // Noon UTC so date slice(0,10) matches client localDate for idempotency.
        last_practiced_at: `${localDate}T12:00:00.000Z`,
      })
      .eq("id", affirmation.id)
      .eq("user_id", userId)
      .select(SELECT)
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
