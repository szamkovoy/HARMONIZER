import { sendRecordingNotices } from "../../../../account/webinarNotices";
import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../../_utils/supabase";
import {
  recordingPostRowFromPayload,
  recordingPostUpdateFromPayload,
  type AdminWebinarRecordingPayload,
} from "../../webinarPayload";
import { isWebinarRecordingTabAvailable } from "@/modules/webinars/core/webinarTiming";

export const runtime = "nodejs";
export const maxDuration = 120;

type RouteContext = { params: Promise<{ id: string }> };

/** Upsert linked posts row (kind=webinar_recording) for this webinar. */
export async function PUT(req: Request, ctx: RouteContext) {
  try {
    const userId = await requireAdmin(req);
    const { id: webinarId } = await ctx.params;
    const payload = (await req.json()) as AdminWebinarRecordingPayload;
    const db = createServiceSupabase();

    const { data: webinar, error: webinarError } = await db
      .from("webinars")
      .select("id, title, starts_at")
      .eq("id", webinarId)
      .maybeSingle();
    if (webinarError) throw webinarError;
    if (!webinar) return json({ error: "Вебинар не найден" }, { status: 404 });
    if (!isWebinarRecordingTabAvailable(webinar.starts_at)) {
      return json({ error: "Вкладка «Запись» доступна через час после начала вебинара" }, { status: 400 });
    }

    const { data: existing, error: existingError } = await db
      .from("posts")
      .select("id, published_at")
      .eq("webinar_id", webinarId)
      .eq("kind", "webinar_recording")
      .maybeSingle();
    if (existingError) throw existingError;

    const letter = { ...payload, is_published: false, cover_url: null };

    if (existing) {
      const update = recordingPostUpdateFromPayload(letter, { published_at: existing.published_at });
      const { data, error } = await db.from("posts").update(update).eq("id", existing.id).select("*").single();
      if (error) throw error;
      const notices = await sendRecordingNotices(db, webinarId).catch((err) => {
        console.error("[webinar] recording emails failed", webinarId, err);
        return { sent: 0, failed: 1 };
      });
      return json({ recording: data, notices });
    }

    const title = letter.title?.trim() || webinar.title;
    const row = recordingPostRowFromPayload({ ...letter, title }, webinarId, userId);
    const { data, error } = await db.from("posts").insert(row).select("*").single();
    if (error) throw error;
    const notices = await sendRecordingNotices(db, webinarId).catch((err) => {
      console.error("[webinar] recording emails failed", webinarId, err);
      return { sent: 0, failed: 1 };
    });
    return json({ recording: data, notices });
  } catch (error) {
    return errorResponse(error);
  }
}
