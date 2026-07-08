import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../_utils/supabase";
import { assertStoryUploadSize, storyUploadKindFromMime } from "../stories/mediaPipeline";

export const runtime = "nodejs";

/** Бакеты, в которые админка может грузить медиа, и допустимые mime по бакету. */
const BUCKETS: Record<string, Record<string, string>> = {
  "story-media": {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
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
    const body = (await req.json()) as {
      contentType?: string;
      bucket?: string;
      folder?: string;
      bytes?: number;
    };
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

    const folder = body.folder?.trim().replace(/^\/+|\/+$/g, "") ?? "";
    if (folder && !/^[a-zA-Z0-9/_-]+$/.test(folder)) {
      return json({ error: "Некорректная папка загрузки" }, { status: 400 });
    }
    if (bucket === "story-media" && (folder === "tmp/stories" || folder.startsWith("tmp/stories/"))) {
      const bytes = typeof body.bytes === "number" ? body.bytes : Number.NaN;
      if (!Number.isFinite(bytes) || bytes <= 0) {
        return json({ error: "Для сторис нужно передать размер файла" }, { status: 400 });
      }
      assertStoryUploadSize(storyUploadKindFromMime(contentType), bytes);
    }

    const datePrefix = new Date().toISOString().slice(0, 10);
    const path = `${folder ? `${folder}/` : ""}${datePrefix}/${crypto.randomUUID()}.${ext}`;
    const storage = createServiceSupabase().storage.from(bucket);
    const { data, error } = await storage.createSignedUploadUrl(path);
    if (error) throw error;

    const { data: pub } = storage.getPublicUrl(path);
    return json({ path: data.path, token: data.token, publicUrl: pub.publicUrl });
  } catch (error) {
    return errorResponse(error);
  }
}
