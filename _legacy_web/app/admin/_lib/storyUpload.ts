import { adminFetch } from "./adminApi";
import { getBrowserSupabase } from "./supabaseBrowser";

type UploadTicket = { path: string; token: string; publicUrl: string };

/**
 * Direct signed upload into Supabase Storage stays under the project global
 * limit (~50 MiB on Free). Larger raw files go chunked through Vercel.
 * After ffmpeg the published object is well under that limit either way.
 */
export const STORY_DIRECT_STORAGE_UPLOAD_MAX_BYTES = 45 * 1024 * 1024;
export const STORY_VIDEO_UPLOAD_MAX_BYTES = 100 * 1024 * 1024;
export const STORY_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;

export type StoryRawUploadRef =
  | { mode: "storage"; upload_path: string; content_type: string }
  | { mode: "session"; upload_session_id: string; content_type: string };

async function uploadViaSignedStorage(
  file: File,
  onProgress?: (label: string) => void,
): Promise<StoryRawUploadRef> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    onProgress?.(attempt === 1 ? "Загружаю файл…" : "Повторяю загрузку…");
    try {
      const ticket = await adminFetch<UploadTicket>("/api/admin/uploads", {
        method: "POST",
        body: JSON.stringify({
          bucket: "story-media",
          folder: "tmp/stories",
          contentType: file.type,
          bytes: file.size,
        }),
      });
      const { error: uploadError } = await getBrowserSupabase()
        .storage.from("story-media")
        .uploadToSignedUrl(ticket.path, ticket.token, file, { contentType: file.type });
      if (uploadError) {
        throw new Error(uploadError.message);
      }
      return { mode: "storage", upload_path: ticket.path, content_type: file.type };
    } catch (error) {
      lastError = error;
      if (attempt === 2) break;
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError ?? "unknown error");
  throw new Error(`Загрузка файла не удалась: ${message}`);
}

async function uploadViaChunks(
  file: File,
  onProgress?: (label: string) => void,
): Promise<StoryRawUploadRef> {
  const sessionId = crypto.randomUUID();
  const chunkTotal = Math.max(1, Math.ceil(file.size / STORY_UPLOAD_CHUNK_BYTES));

  for (let chunkIndex = 0; chunkIndex < chunkTotal; chunkIndex += 1) {
    const start = chunkIndex * STORY_UPLOAD_CHUNK_BYTES;
    const end = Math.min(file.size, start + STORY_UPLOAD_CHUNK_BYTES);
    const form = new FormData();
    form.set("session_id", sessionId);
    form.set("chunk_index", String(chunkIndex));
    form.set("chunk_total", String(chunkTotal));
    form.set("content_type", file.type);
    form.set("bytes", String(file.size));
    form.set("chunk", file.slice(start, end), `chunk-${chunkIndex}`);

    onProgress?.(`Загружаю… ${chunkIndex + 1}/${chunkTotal}`);
    await adminFetch(
      "/api/admin/stories/upload-chunk",
      { method: "POST", body: form },
      { timeoutMs: 120_000 },
    );
  }

  return { mode: "session", upload_session_id: sessionId, content_type: file.type };
}

export async function uploadStoryRawFile(
  file: File,
  onProgress?: (label: string) => void,
): Promise<StoryRawUploadRef> {
  const isImage = file.type.startsWith("image/");
  const maxBytes = isImage ? 30 * 1024 * 1024 : STORY_VIDEO_UPLOAD_MAX_BYTES;
  if (file.size > maxBytes) {
    const limitLabel = isImage ? "30 МБ" : "100 МБ";
    throw new Error(
      isImage
        ? `Файл (${Math.round(file.size / 1024 / 1024)} МБ) превышает лимит ${limitLabel} для фото сторис.`
        : `Файл (${Math.round(file.size / 1024 / 1024)} МБ) превышает лимит ${limitLabel}. Запишите видео короче (~45 секунд при съёмке на iPhone) или уменьшите качество и попробуйте снова.`,
    );
  }
  if (!isImage && file.size > STORY_DIRECT_STORAGE_UPLOAD_MAX_BYTES) {
    return uploadViaChunks(file, onProgress);
  }
  return uploadViaSignedStorage(file, onProgress);
}

export function storyProcessUploadBody(ref: StoryRawUploadRef): Record<string, string> {
  if (ref.mode === "session") {
    return { upload_session_id: ref.upload_session_id, content_type: ref.content_type };
  }
  return { upload_path: ref.upload_path, content_type: ref.content_type };
}
