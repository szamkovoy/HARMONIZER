import { put } from "@vercel/blob";

import { imageFromUploadBody } from "../../../_utils/emailImageUpload";
import { getEmailPublicBaseUrl } from "../../../_utils/marketingMail";
import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const YEAR_SECONDS = 31_536_000;
const MAX_BYTES = 3 * 1024 * 1024;

/** Public letter URL. The blob host itself does not open in Russia. */
function publicEmailImageUrl(blobUrl: string): string {
  const path = blobUrl.replace(/^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//i, "");
  return `${getEmailPublicBaseUrl()}/email-cdn/${path}`;
}

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
 * New letter images go to Vercel Blob (public CDN). The HTML keeps that URL.
 * `/api/email/asset` stays only for letters already sent with a Supabase URL.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
      return json({ error: "BLOB_READ_WRITE_TOKEN не задан" }, { status: 500 });
    }

    const { bytes, mime } = await readImageUpload(req);
    if (bytes.length === 0) {
      return json({ error: "Файл пустой" }, { status: 400 });
    }
    if (bytes.length > MAX_BYTES) {
      return json({ error: "Максимум 3 МБ" }, { status: 400 });
    }
    if (!mime.startsWith("image/")) {
      return json({ error: "Только изображения" }, { status: 400 });
    }

    const ext = extForMime(mime);
    const path = `email-assets/campaigns/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const blob = await put(path, bytes, {
      access: "public",
      contentType: mime,
      cacheControlMaxAge: YEAR_SECONDS,
      addRandomSuffix: false,
    });

    const publicUrl = publicEmailImageUrl(blob.url);
    const db = createServiceSupabase();
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
