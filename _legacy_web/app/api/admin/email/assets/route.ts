import { put } from "@vercel/blob";

import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

const YEAR_SECONDS = 31_536_000;
const MAX_BYTES = 3 * 1024 * 1024;

function extForMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "jpg";
}

function sniffImageMime(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  const head = bytes.length >= 6 ? bytes.toString("ascii", 0, 6) : "";
  if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Prefer a raw `image/*` body. Multipart through harmonizer.zamkovoi.yoga loses
 * its boundary (`no boundary found in multipart body`) and never reaches storage.
 */
async function readImageUpload(req: Request): Promise<{ bytes: Buffer; mime: string }> {
  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw json(
        { error: "Файл не дошёл. Обновите страницу админки и загрузите изображение ещё раз." },
        { status: 400 },
      );
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw json({ error: "Ожидается file" }, { status: 400 });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const mime = file.type.startsWith("image/") ? file.type : sniffImageMime(bytes);
    if (!mime) throw json({ error: "Только изображения" }, { status: 400 });
    return { bytes, mime };
  }

  const bytes = Buffer.from(await req.arrayBuffer());
  const headerMime = contentType.split(";")[0]?.trim() || "";
  const mime = headerMime.startsWith("image/") ? headerMime : sniffImageMime(bytes);
  if (!mime) throw json({ error: "Только изображения" }, { status: 400 });
  return { bytes, mime };
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

    const db = createServiceSupabase();
    const { error: insertError } = await db.from("email_assets").insert({
      path,
      public_url: blob.url,
    });
    if (insertError) throw insertError;

    return json({ path, public_url: blob.url });
  } catch (error) {
    return errorResponse(error);
  }
}
