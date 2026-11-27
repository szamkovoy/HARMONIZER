import { randomUUID } from "node:crypto";

import { imageFromUploadBody } from "../../../_utils/emailImageUpload";
import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const YEAR_SECONDS = 31_536_000;
const MAX_BYTES = 3 * 1024 * 1024;
const BUCKET = "email-assets";

function extForMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "jpg";
}

/**
 * Raw `image/*` is the normal path. An already-open admin tab still sends
 * multipart; the yoga proxy drops the boundary, so parse the body ourselves.
 */
async function readImageUpload(req: Request): Promise<{ bytes: Buffer; mime: string }> {
  const contentType = req.headers.get("content-type") ?? "";
  const raw = Buffer.from(await req.arrayBuffer());
  const image = imageFromUploadBody(raw, contentType);
  if (!image) {
    console.error("[email-assets] unreadable upload", {
      bytes: raw.length,
      contentType: contentType.slice(0, 160),
    });
    throw json(
      {
        error:
          raw.length === 0
            ? "Файл не дошёл. Обновите страницу админки полностью и загрузите изображение ещё раз."
            : "Не удалось прочитать файл. Сохраните его как JPEG до 3 МБ и загрузите снова.",
      },
      { status: 400 },
    );
  }
  return image;
}

/**
 * Store the author's original bytes in the existing public Storage bucket.
 * The direct URL lets mail clients load images without the REG.RU → Vercel hop.
 * Existing Blob/CDN and legacy /api/email/asset URLs remain available separately.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);

    const { bytes, mime } = await readImageUpload(req);
    if (bytes.length === 0) {
      return json({ error: "Файл пустой" }, { status: 400 });
    }
    if (bytes.length > MAX_BYTES) {
      return json({ error: "Максимум 3 МБ" }, { status: 400 });
    }
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(mime)) {
      return json({ error: "Поддерживаются JPEG, PNG, WebP и GIF" }, { status: 400 });
    }

    const ext = extForMime(mime);
    const path = `campaigns/${Date.now()}-${randomUUID()}.${ext}`;
    const db = createServiceSupabase();
    const bucket = db.storage.from(BUCKET);
    const { error: uploadError } = await bucket.upload(path, bytes, {
      contentType: mime,
      cacheControl: String(YEAR_SECONDS),
      upsert: false,
    });
    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = bucket.getPublicUrl(path);
    const { error: insertError } = await db.from("email_assets").insert({
      path,
      public_url: publicUrl,
    });
    if (insertError) throw insertError;

    return json({ path, public_url: publicUrl });
  } catch (error) {
    return errorResponse(error);
  }
}
