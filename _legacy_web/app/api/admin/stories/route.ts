import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../_utils/supabase";
import { storyRowFromPayload, type AdminStoryPayload } from "./storyPayload";

export const runtime = "nodejs";

/** Список всех сторис (включая черновики и истёкшие), свежие сверху. */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const { data, error } = await createServiceSupabase()
      .from("stories")
      .select("*")
      .order("publish_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return json({ stories: data });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const userId = await requireAdmin(req);
    const body = (await req.json()) as AdminStoryPayload;
    const row = { ...storyRowFromPayload(body), created_by: userId };
    const { data, error } = await createServiceSupabase()
      .from("stories")
      .insert(row)
      .select("*")
      .single();
    if (error) throw error;
    return json({ story: data });
  } catch (error) {
    return errorResponse(error);
  }
}
