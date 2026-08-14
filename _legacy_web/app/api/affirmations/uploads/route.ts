import {
  createServiceSupabase,
  errorResponse,
  json,
  requireUserId,
} from "../../_utils/supabase";

export const runtime = "nodejs";

const MAX_BYTES = 5_242_880; // 5 MB
const MIME_TO_EXT: Record<string, string> = {
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/webm": "webm",
};

/**
 * Signed upload URL for affirmation voice recordings (private bucket).
 * Path: {userId}/{date}/{uuid}.{ext}
 */
export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const body = (await req.json()) as { contentType?: string; bytes?: number };
    const contentType = body.contentType?.trim().toLowerCase() ?? "";
    const ext = MIME_TO_EXT[contentType];
    if (!ext) {
      return json({ error: "Допустимы audio/mp4, m4a, aac, mpeg, webm" }, { status: 400 });
    }
    const bytes = typeof body.bytes === "number" ? body.bytes : Number.NaN;
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return json({ error: "Нужен размер файла" }, { status: 400 });
    }
    if (bytes > MAX_BYTES) {
      return json({ error: "Файл больше 5 МБ" }, { status: 400 });
    }

    const datePrefix = new Date().toISOString().slice(0, 10);
    const path = `${userId}/${datePrefix}/${crypto.randomUUID()}.${ext}`;
    const storage = createServiceSupabase().storage.from("affirmation-audio");
    const { data, error } = await storage.createSignedUploadUrl(path);
    if (error) throw error;

    return json({
      path: data.path,
      token: data.token,
      signedUrl: data.signedUrl,
      contentType,
      maxBytes: MAX_BYTES,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
