import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../_utils/supabase";
import { webinarRowFromPayload, type AdminWebinarPayload } from "./webinarPayload";

export const runtime = "nodejs";

/** Все вебинары (включая черновики) со счётчиками записавшихся и вопросов. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const db = createServiceSupabase();
    const { data: webinars, error } = await db
      .from("webinars")
      .select("*")
      .order("starts_at", { ascending: false })
      .limit(200);
    if (error) throw error;

    const ids = (webinars ?? []).map((w) => w.id);
    const registrations = new Map<string, number>();
    const questions = new Map<string, number>();
    const recordings = new Map<
      string,
      { id: string; is_published: boolean; comment_count: number }
    >();
    if (ids.length > 0) {
      const [regsRes, questionsRes, recordingsRes] = await Promise.all([
        db.from("webinar_registrations").select("webinar_id").in("webinar_id", ids),
        db.from("comments").select("target_id").eq("target_type", "webinar").in("target_id", ids),
        db
          .from("posts")
          .select("id, webinar_id, is_published")
          .eq("kind", "webinar_recording")
          .in("webinar_id", ids),
      ]);
      if (regsRes.error) throw regsRes.error;
      if (questionsRes.error) throw questionsRes.error;
      if (recordingsRes.error) throw recordingsRes.error;
      for (const row of regsRes.data ?? []) {
        registrations.set(row.webinar_id, (registrations.get(row.webinar_id) ?? 0) + 1);
      }
      for (const row of questionsRes.data ?? []) {
        questions.set(row.target_id, (questions.get(row.target_id) ?? 0) + 1);
      }
      const recordingIds = (recordingsRes.data ?? []).map((r) => r.id);
      const recordingCommentCounts = new Map<string, number>();
      if (recordingIds.length > 0) {
        const { data: recComments, error: recCommentsError } = await db
          .from("comments")
          .select("target_id")
          .eq("target_type", "post")
          .in("target_id", recordingIds);
        if (recCommentsError) throw recCommentsError;
        for (const row of recComments ?? []) {
          recordingCommentCounts.set(row.target_id, (recordingCommentCounts.get(row.target_id) ?? 0) + 1);
        }
      }
      for (const row of recordingsRes.data ?? []) {
        if (!row.webinar_id) continue;
        recordings.set(row.webinar_id, {
          id: row.id,
          is_published: row.is_published,
          comment_count: recordingCommentCounts.get(row.id) ?? 0,
        });
      }
    }

    return json({
      webinars: (webinars ?? []).map((w) => {
        const recording = recordings.get(w.id) ?? null;
        return {
          ...w,
          registration_count: registrations.get(w.id) ?? 0,
          question_count: questions.get(w.id) ?? 0,
          recording_post_id: recording?.id ?? null,
          recording_is_published: recording?.is_published ?? false,
          recording_comment_count: recording?.comment_count ?? 0,
        };
      }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const payload = (await req.json()) as AdminWebinarPayload;
    const { data, error } = await createServiceSupabase()
      .from("webinars")
      .insert(webinarRowFromPayload(payload))
      .select("*")
      .single();
    if (error) throw error;
    return json({ webinar: data });
  } catch (error) {
    return errorResponse(error);
  }
}
