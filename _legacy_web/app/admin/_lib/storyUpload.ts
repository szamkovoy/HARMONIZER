import { adminFetch } from "./adminApi";
import { getBrowserSupabase } from "./supabaseBrowser";

type UploadTicket = { path: string; token: string; publicUrl: string };

/** Raw file limit: after ffmpeg the output will be well under Supabase 50 MiB/object. */
export const STORY_DIRECT_STORAGE_UPLOAD_MAX_BYTES = 45 * 1024 * 1024;

export type StoryRawUploadRef = { mode: "storage"; upload_path: string; content_type: string };

export async function uploadStoryRawFile(
  file: File,
  onProgress?: (label: string) => void,
): Promise<StoryRawUploadRef> {
  if (file.size > STORY_DIRECT_STORAGE_UPLOAD_MAX_BYTES) {
    throw new Error(
      `Файл (${Math.round(file.size / 1024 / 1024)} МБ) превышает лимит 45 МБ. Запишите видео короче (~45 секунд при съёмке на iPhone) и попробуйте снова.`,
    );
  }
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

export function storyProcessUploadBody(ref: StoryRawUploadRef): Record<string, string> {
  return { upload_path: ref.upload_path, content_type: ref.content_type };
}
