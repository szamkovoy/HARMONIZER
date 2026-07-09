import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";
import { removeStorageObjects } from "../../_utils/storageCleanup";
import {
  buildProcessedStoryPath,
  processStoryMedia,
  validateStoryUploadPath,
} from "../mediaPipeline";
import { storyRowFromPayload } from "../storyPayload";

export const runtime = "nodejs";
export const maxDuration = 120;

type ProcessStoryPayload = {
  upload_path?: string;
  content_type?: string;
  caption?: string;
  caption_translations?: Record<string, string>;
  publish_at?: string | null;
  expires_at?: string | null;
  is_evergreen?: boolean;
  is_published?: boolean;
  order_hint?: number;
  /** When set, update this existing story's media instead of creating a new row. */
  update_id?: string;
};

async function uploadAsset(
  path: string,
  file: { buffer: Buffer; contentType: string },
): Promise<string> {
  const db = createServiceSupabase();
  const { error } = await db.storage.from("story-media").upload(path, file.buffer, {
    contentType: file.contentType,
    upsert: false,
  });
  if (error) throw error;
  const { data } = db.storage.from("story-media").getPublicUrl(path);
  return data.publicUrl;
}

export async function POST(req: Request) {
  const uploadedPaths: string[] = [];
  let tempPath: string | null = null;

  try {
    const userId = await requireAdmin(req);
    const body = (await req.json()) as ProcessStoryPayload;
    const contentType = body.content_type?.trim() ?? "";
    tempPath = validateStoryUploadPath(body.upload_path?.trim() ?? "");

    const db = createServiceSupabase();
    const { data: blob, error: downloadError } = await db.storage.from("story-media").download(tempPath);
    if (downloadError) throw downloadError;

    const sourceBuffer = Buffer.from(await blob.arrayBuffer());
    const processed = await processStoryMedia(sourceBuffer, contentType);

    const mainPath = buildProcessedStoryPath("main", processed.main.ext);
    const mainUrl = await uploadAsset(mainPath, processed.main);
    uploadedPaths.push(mainPath);

    const thumbPath = buildProcessedStoryPath("thumb", processed.thumbnail.ext);
    const thumbnailUrl = await uploadAsset(thumbPath, processed.thumbnail);
    uploadedPaths.push(thumbPath);

    const coverUrl =
      processed.kind === "video"
        ? await (async () => {
            const path = buildProcessedStoryPath("cover", processed.cover.ext);
            const url = await uploadAsset(path, processed.cover);
            uploadedPaths.push(path);
            return url;
          })()
        : null;

    if (body.update_id) {
      // Media replacement: read old media URLs, update row, then delete old assets.
      const { data: old, error: readErr } = await db
        .from("stories")
        .select("image_url, video_url, cover_url, thumbnail_url")
        .eq("id", body.update_id)
        .maybeSingle();
      if (readErr) throw readErr;
      if (!old) return json({ error: "Сторис не найдена" }, { status: 404 });

      const mediaUpdate: Record<string, unknown> = {
        kind: processed.kind,
        image_url: processed.kind === "image" ? mainUrl : null,
        video_url: processed.kind === "video" ? mainUrl : null,
        cover_url: coverUrl,
        thumbnail_url: thumbnailUrl,
      };

      const { data: story, error: updateErr } = await db
        .from("stories")
        .update(mediaUpdate)
        .eq("id", body.update_id)
        .select("*")
        .single();
      if (updateErr) throw updateErr;

      if (tempPath) await removeStorageObjects(db, "story-media", [tempPath]);

      // Delete old media assets after successful update.
      await removeStorageObjects(db, "story-media", [
        old.image_url,
        old.video_url,
        old.cover_url,
        old.thumbnail_url,
      ].filter((u): u is string => typeof u === "string" && u.trim().length > 0));

      return json({ story, processed: { kind: processed.kind, duration_ms: processed.durationMs } });
    }

    const storyRow = storyRowFromPayload({
      kind: processed.kind,
      image_url: processed.kind === "image" ? mainUrl : null,
      video_url: processed.kind === "video" ? mainUrl : null,
      cover_url: coverUrl,
      thumbnail_url: thumbnailUrl,
      caption: body.caption,
      caption_translations: body.caption_translations,
      publish_at: body.publish_at,
      expires_at: body.expires_at,
      is_evergreen: body.is_evergreen,
      is_published: body.is_published ?? true,
      order_hint: body.order_hint,
    });

    const { data: story, error } = await db
      .from("stories")
      .insert({ ...storyRow, created_by: userId })
      .select("*")
      .single();
    if (error) throw error;

    if (tempPath) await removeStorageObjects(db, "story-media", [tempPath]);
    return json({ story, processed: { kind: processed.kind, duration_ms: processed.durationMs } });
  } catch (error) {
    const db = createServiceSupabase();
    if (tempPath) await removeStorageObjects(db, "story-media", [tempPath]);
    if (uploadedPaths.length > 0) await removeStorageObjects(db, "story-media", uploadedPaths);
    return errorResponse(error);
  }
}
