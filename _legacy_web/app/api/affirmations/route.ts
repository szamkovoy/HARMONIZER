import {
  createServiceSupabase,
  errorResponse,
  json,
  requireUserId,
} from "@legacy/app/api/_utils/supabase";

export const runtime = "nodejs";

export type AffirmationRow = {
  id: string;
  user_id: string;
  text: string;
  audio_url: string | null;
  status: "active" | "completed" | "archived";
  current_day: number;
  last_practiced_at: string | null;
  cycle_started_at: string;
  created_at: string;
  updated_at: string;
};

const SELECT =
  "id, user_id, text, audio_url, status, current_day, last_practiced_at, cycle_started_at, created_at, updated_at";

async function signedAudioUrl(
  path: string | null,
): Promise<string | null> {
  if (!path) return null;
  const storage = createServiceSupabase().storage.from("affirmation-audio");
  const { data, error } = await storage.createSignedUrl(path, 60 * 60 * 6);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function serializeAffirmation(row: AffirmationRow) {
  return {
    id: row.id,
    text: row.text,
    audioPath: row.audio_url,
    audioSignedUrl: await signedAudioUrl(row.audio_url),
    status: row.status,
    currentDay: row.current_day,
    lastPracticedAt: row.last_practiced_at,
    cycleStartedAt: row.cycle_started_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** GET active affirmation (or null). */
export async function GET(req: Request) {
  try {
    const userId = await requireUserId(req);
    const db = createServiceSupabase();
    const { data, error } = await db
      .from("user_affirmations")
      .select(SELECT)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();
    if (error) throw error;
    if (!data) return json({ affirmation: null });
    return json({ affirmation: await serializeAffirmation(data as AffirmationRow) });
  } catch (error) {
    return errorResponse(error);
  }
}

type CreateBody = {
  text?: string;
  audioPath?: string | null;
};

/** POST create/activate a new affirmation (archives previous active). */
export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const body = (await req.json()) as CreateBody;
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text || text.length < 8) {
      return json({ error: "Слишком короткий текст аффирмации." }, { status: 400 });
    }
    if (text.length > 500) {
      return json({ error: "Текст слишком длинный." }, { status: 400 });
    }
    const audioPath =
      typeof body.audioPath === "string" && body.audioPath.trim()
        ? body.audioPath.trim()
        : null;
    if (audioPath && !audioPath.startsWith(`${userId}/`)) {
      return json({ error: "Некорректный путь аудио." }, { status: 400 });
    }

    const db = createServiceSupabase();
    // Archive any current active rows.
    const { error: archiveError } = await db
      .from("user_affirmations")
      .update({ status: "archived" })
      .eq("user_id", userId)
      .eq("status", "active");
    if (archiveError) throw archiveError;

    const { data, error } = await db
      .from("user_affirmations")
      .insert({
        user_id: userId,
        text,
        audio_url: audioPath,
        status: "active",
        current_day: 0,
        cycle_started_at: new Date().toISOString(),
      })
      .select(SELECT)
      .single();
    if (error) throw error;

    return json({ affirmation: await serializeAffirmation(data as AffirmationRow) });
  } catch (error) {
    return errorResponse(error);
  }
}
