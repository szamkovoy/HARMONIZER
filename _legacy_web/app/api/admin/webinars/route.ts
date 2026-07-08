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
    if (ids.length > 0) {
      const [regsRes, questionsRes] = await Promise.all([
        db.from("webinar_registrations").select("webinar_id").in("webinar_id", ids),
        db.from("comments").select("target_id").eq("target_type", "webinar").in("target_id", ids),
      ]);
      if (regsRes.error) throw regsRes.error;
      if (questionsRes.error) throw questionsRes.error;
      for (const row of regsRes.data ?? []) {
        registrations.set(row.webinar_id, (registrations.get(row.webinar_id) ?? 0) + 1);
      }
      for (const row of questionsRes.data ?? []) {
        questions.set(row.target_id, (questions.get(row.target_id) ?? 0) + 1);
      }
    }

    return json({
      webinars: (webinars ?? []).map((w) => ({
        ...w,
        registration_count: registrations.get(w.id) ?? 0,
        question_count: questions.get(w.id) ?? 0,
      })),
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
