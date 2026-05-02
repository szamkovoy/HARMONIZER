import { createServiceSupabase, errorResponse, json, requireUserId } from "../../../_utils/supabase";
import { choosePractice, publicPracticePickedPayload } from "../dialog/practiceSelection";

export const runtime = "nodejs";

type Body = {
  practiceId?: string;
  planetOfTheDay?: string;
  reason?: string;
};

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const body = (await req.json()) as Body;
    const db = createServiceSupabase();
    const selected = await choosePractice(
      db,
      userId,
      body.practiceId ? { id: body.practiceId, reason: body.reason } : null,
      { forecast: { planet_of_the_day: body.planetOfTheDay ?? "Sun" } },
      "Подбери практику из каталога",
      [],
    );
    if (!selected) return json({ error: "No active practices found" }, { status: 404 });
    const practicePicked = publicPracticePickedPayload(selected, body.reason);

    await db.from("user_event_log").insert({
      user_id: userId,
      kind: "practice_selected",
      payload: {
        practice_id: selected.id,
        reason: body.reason ?? null,
        source: body.practiceId === selected.id ? "model_pick" : "fallback_top_ranked",
        endpoint: "communicator/v2/select-practice",
      },
    });

    return json({
      practicePicked,
      stack: (selected.stack ?? []).map((practice) => ({
        id: practice.id,
        name: typeof practice.title === "string" ? practice.title : practice.title?.ru ?? practice.title?.en ?? practice.slug,
        kind: practice.kind,
        durationSec: practice.default_duration_sec,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
