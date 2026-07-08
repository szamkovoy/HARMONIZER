import type { SupabaseClient } from "@supabase/supabase-js";

export async function removeStorageObjects(
  db: SupabaseClient,
  bucket: string,
  paths: Array<string | null | undefined>,
): Promise<void> {
  const cleanPaths = paths
    .filter((path): path is string => typeof path === "string" && path.trim().length > 0)
    .map((path) => path.trim());
  if (cleanPaths.length === 0) return;
  const { error } = await db.storage.from(bucket).remove(cleanPaths);
  if (error) console.error(`[admin] storage cleanup failed (${bucket})`, error.message);
}

/**
 * Удаляет из Storage файлы, чьи public-URL лежат в переданном списке.
 * Ошибка очистки логируется, но не пробрасывается: строка контента к этому
 * моменту уже удалена, и 500 только запутает админа.
 */
export async function removeStorageObjectsByPublicUrls(
  db: SupabaseClient,
  bucket: string,
  urls: Array<string | null | undefined>,
): Promise<void> {
  const marker = `/storage/v1/object/public/${bucket}/`;
  const paths = urls
    .filter((url): url is string => typeof url === "string" && url.includes(marker))
    .map((url) => decodeURIComponent(url.split(marker)[1] ?? "").split("?")[0])
    .filter(Boolean);
  await removeStorageObjects(db, bucket, paths);
}
