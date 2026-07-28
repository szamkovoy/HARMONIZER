import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Upload image to public email-assets bucket; returns public URL. */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return json({ error: "Ожидается file" }, { status: 400 });
    }
    if (file.size > 3 * 1024 * 1024) {
      return json({ error: "Максимум 3 МБ" }, { status: 400 });
    }
    const mime = file.type || "image/jpeg";
    if (!mime.startsWith("image/")) {
      return json({ error: "Только изображения" }, { status: 400 });
    }

    const ext = mime.includes("png")
      ? "png"
      : mime.includes("webp")
        ? "webp"
        : mime.includes("gif")
          ? "gif"
          : "jpg";
    const path = `campaigns/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const db = createServiceSupabase();

    const { error: uploadError } = await db.storage
      .from("email-assets")
      .upload(path, buffer, {
        contentType: mime,
        // Seconds (Supabase Storage API). Long cache for mail clients / CDN.
        cacheControl: "31536000",
        upsert: false,
      });
    if (uploadError) throw uploadError;

    const { data: pub } = db.storage.from("email-assets").getPublicUrl(path);
    const publicUrl = pub.publicUrl;

    await db.from("email_assets").insert({ path, public_url: publicUrl });

    return json({ path, public_url: publicUrl });
  } catch (error) {
    return errorResponse(error);
  }
}
