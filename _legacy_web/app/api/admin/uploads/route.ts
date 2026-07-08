import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../_utils/supabase";

export const runtime = "nodejs";

/** Бакеты, в которые админка может грузить медиа, и допустимые mime по бакету. */
const BUCKETS: Record<string, Record<string, string>> = {
  "story-media": {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
  },
  "post-covers": {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  },
};

/**
 * Выдаёт signed upload URL: браузер грузит файл напрямую в Supabase Storage
 * (мимо лимита тела Vercel ~4.5 МБ). Возвращает token+path для
 * uploadToSignedUrl и итоговый publicUrl для записи в строку контента.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const body = (await req.json()) as { contentType?: string; bucket?: string };
    const bucket = body.bucket ?? "story-media";
    const extByMime = BUCKETS[bucket];
    if (!extByMime) {
      return json({ error: `Неизвестный бакет: ${bucket}` }, { status: 400 });
    }
    const contentType = body.contentType?.trim() ?? "";
    const ext = extByMime[contentType];
    if (!ext) {
      return json({ error: `Неподдерживаемый тип файла: ${contentType || "неизвестен"}` }, { status: 400 });
    }

    const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
    const storage = createServiceSupabase().storage.from(bucket);
    const { data, error } = await storage.createSignedUploadUrl(path);
    if (error) throw error;

    const { data: pub } = storage.getPublicUrl(path);
    return json({ path: data.path, token: data.token, publicUrl: pub.publicUrl });
  } catch (error) {
    return errorResponse(error);
  }
}
