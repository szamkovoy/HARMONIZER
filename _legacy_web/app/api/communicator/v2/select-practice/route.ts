import { createServiceSupabase, errorResponse, json, requireUserId } from "../../../_utils/supabase";

export const runtime = "nodejs";

type Body = {
  practiceId?: string;
  planetOfTheDay?: string;
  reason?: string;
};

const PLANET_TO_CHAKRA: Record<string, number> = { Moon: 1, Venus: 2, Mars: 3, Jupiter: 4, Saturn: 5, Mercury: 6, Sun: 7 };

function titleOf(title: unknown, fallback: string): string {
  if (typeof title === "string") return title;
  if (title && typeof title === "object") {
    const record = title as Record<string, unknown>;
    return String(record.ru ?? record.en ?? fallback);
  }
  return fallback;
}

export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const body = (await req.json()) as Body;
    const db = createServiceSupabase();
    const chakraId = PLANET_TO_CHAKRA[body.planetOfTheDay ?? ""] ?? 7;

    const { data, error } = await db
      .from("practices")
      .select("id,slug,title,kind,default_duration_sec,practice_chakras!inner(chakra_id,weight)")
      .eq("is_active", true)
      .eq("practice_chakras.chakra_id", chakraId)
      .order("rating", { ascending: false })
      .limit(7);
    if (error) throw error;

    const stack = (data ?? []) as Array<{ id: string; slug: string; title: unknown; kind: string; default_duration_sec: number | null }>;
    const picked = stack.find((practice) => practice.id === body.practiceId) ?? stack[0];
    if (!picked) return json({ error: "No active practices found" }, { status: 404 });

    await db.from("user_event_log").insert({
      user_id: userId,
      kind: "practice_selected",
      payload: {
        practice_id: picked.id,
        reason: body.reason ?? null,
        source: body.practiceId === picked.id ? "model_pick" : "fallback_top_ranked",
      },
    });

    return json({
      practicePicked: {
        id: picked.id,
        name: titleOf(picked.title, picked.slug),
        reason: body.reason,
      },
      stack: stack.map((practice) => ({
        id: practice.id,
        name: titleOf(practice.title, practice.slug),
        kind: practice.kind,
        durationSec: practice.default_duration_sec,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
