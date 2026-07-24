import {
  createServiceSupabase,
  errorResponse,
  json,
  requireUserId,
} from "../../_utils/supabase";

export const runtime = "nodejs";

const MAX_BYTES = 3_145_728; // 3 MB
const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Signed upload URL for support screenshots (private bucket).
 * Path: {userId}/{date}/{uuid}.{ext}
 */
export async function POST(req: Request) {
  try {
    const userId = await requireUserId(req);
    const body = (await req.json()) as { contentType?: string; bytes?: number };
    const contentType = body.contentType?.trim().toLowerCase() ?? "";
    const ext = MIME_TO_EXT[contentType];
    if (!ext) {
      return json(
        { error: "Допустимы только JPEG, PNG или WebP" },
        { status: 400 },
      );
    }
    const bytes = typeof body.bytes === "number" ? body.bytes : Number.NaN;
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return json({ error: "Нужен размер файла" }, { status: 400 });
    }
    if (bytes > MAX_BYTES) {
      return json({ error: "Файл больше 3 МБ" }, { status: 400 });
    }

    const datePrefix = new Date().toISOString().slice(0, 10);
    const path = `${userId}/${datePrefix}/${crypto.randomUUID()}.${ext}`;
    const storage = createServiceSupabase().storage.from("support-attachments");
    const { data, error } = await storage.createSignedUploadUrl(path);
    if (error) throw error;

    return json({
      path: data.path,
      token: data.token,
      // Полный URL с bucket в path — клиент шлёт PUT напрямую (uploadAsync).
      signedUrl: data.signedUrl,
      contentType,
      maxBytes: MAX_BYTES,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
