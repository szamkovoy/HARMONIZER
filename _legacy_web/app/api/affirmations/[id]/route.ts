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

type PatchBody = {
  text?: string;
  audioPath?: string | null;
  status?: "active" | "completed" | "archived";
  /** Keep current cycle when completing at day 30+ and choosing to keep. */
  resetCycle?: boolean;
};

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await requireUserId(req);
    const { id } = await ctx.params;
    if (!id) return json({ error: "Missing id" }, { status: 400 });

    const body = (await req.json()) as PatchBody;
    const patch: Record<string, unknown> = {};

    if (typeof body.text === "string") {
      const text = body.text.trim();
      if (text.length < 8 || text.length > 500) {
        return json({ error: "Некорректный текст." }, { status: 400 });
      }
      patch.text = text;
    }

    if (body.audioPath !== undefined) {
      if (body.audioPath === null || body.audioPath === "") {
        patch.audio_url = null;
      } else if (typeof body.audioPath === "string" && body.audioPath.startsWith(`${userId}/`)) {
        patch.audio_url = body.audioPath.trim();
      } else {
        return json({ error: "Некорректный путь аудио." }, { status: 400 });
      }
    }

    if (body.status === "archived" || body.status === "completed" || body.status === "active") {
      patch.status = body.status;
    }

    if (body.resetCycle === true) {
      patch.current_day = 0;
      patch.cycle_started_at = new Date().toISOString();
      patch.last_practiced_at = null;
      patch.status = "active";
    }

    if (Object.keys(patch).length === 0) {
      return json({ error: "Нет изменений." }, { status: 400 });
    }

    const db = createServiceSupabase();
    const { data, error } = await db
      .from("user_affirmations")
      .update(patch)
      .eq("id", id)
      .eq("user_id", userId)
      .select(AFFIRMATION_SELECT)
      .maybeSingle();
    if (error) throw error;
    if (!data) return json({ error: "Не найдено." }, { status: 404 });

    return json({ affirmation: await serializeAffirmation(data as AffirmationRow) });
  } catch (error) {
    return errorResponse(error);
  }
}
