import { createServiceSupabase } from "../../_utils/supabase";

/**
 * Chunked story uploads cannot use instance-local `/tmp` on Vercel: each
 * `upload-chunk` / `process` request may hit a different serverless isolate.
 * Chunks live in shared Supabase Storage under `tmp/stories/sessions/*`
 * (each object ≪ 50 MiB global limit). After `process`, the session folder
 * is deleted; only the ffmpeg/sharp output remains.
 */
export const STORY_DIRECT_STORAGE_UPLOAD_MAX_BYTES = 45 * 1024 * 1024;
export const STORY_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;

const BUCKET = "story-media";
const SESSION_PREFIX = "tmp/stories/sessions";
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type StoryUploadSessionMeta = {
  content_type: string;
  chunk_total: number;
  bytes: number;
};

export function assertStoryUploadSessionId(sessionId: string): string {
  const trimmed = sessionId.trim();
  if (!SESSION_ID_RE.test(trimmed)) {
    throw new Error("Некорректный идентификатор сессии загрузки");
  }
  return trimmed;
}

function sessionBase(sessionId: string): string {
  return `${SESSION_PREFIX}/${assertStoryUploadSessionId(sessionId)}`;
}

function metaObjectPath(sessionId: string): string {
  return `${sessionBase(sessionId)}/meta.json`;
}

function chunkObjectPath(sessionId: string, index: number): string {
  return `${sessionBase(sessionId)}/chunk-${String(index).padStart(4, "0")}`;
}

async function uploadSessionObject(path: string, body: Buffer | string, contentType: string): Promise<void> {
  const storage = createServiceSupabase().storage.from(BUCKET);
  const { error } = await storage.upload(path, body, {
    contentType,
    upsert: true,
  });
  if (error) throw error;
}

export async function writeStoryUploadChunk(
  sessionId: string,
  chunkIndex: number,
  chunkTotal: number,
  contentType: string,
  bytes: number,
  chunk: Buffer,
): Promise<void> {
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= chunkTotal) {
    throw new Error("Некорректный номер части загрузки");
  }
  if (!Number.isInteger(chunkTotal) || chunkTotal <= 0 || chunkTotal > 512) {
    throw new Error("Некорректное число частей загрузки");
  }
  if (!Number.isFinite(bytes) || bytes <= 0) {
    throw new Error("Некорректный размер файла");
  }

  // Bucket `story-media` only allows image/video MIME types — use the source
  // media contentType for meta + chunk objects (body is still JSON / raw bytes).
  if (chunkIndex === 0) {
    const meta: StoryUploadSessionMeta = { content_type: contentType, chunk_total: chunkTotal, bytes };
    await uploadSessionObject(metaObjectPath(sessionId), JSON.stringify(meta), contentType);
  } else {
    const meta = await readStoryUploadSessionMeta(sessionId);
    if (meta.chunk_total !== chunkTotal || meta.bytes !== bytes || meta.content_type !== contentType) {
      throw new Error("Метаданные сессии загрузки не совпадают");
    }
  }

  await uploadSessionObject(chunkObjectPath(sessionId, chunkIndex), chunk, contentType);
}

export async function readStoryUploadSessionMeta(sessionId: string): Promise<StoryUploadSessionMeta> {
  const storage = createServiceSupabase().storage.from(BUCKET);
  const { data, error } = await storage.download(metaObjectPath(sessionId));
  if (error || !data) {
    throw new Error("Сессия загрузки не найдена или ещё не инициализирована");
  }
  const raw = JSON.parse(await data.text()) as StoryUploadSessionMeta;
  if (!raw.content_type || !raw.chunk_total || !raw.bytes) {
    throw new Error("Повреждённые метаданные сессии загрузки");
  }
  return raw;
}

export async function assembleStoryUploadSession(sessionId: string): Promise<{ buffer: Buffer; contentType: string }> {
  const meta = await readStoryUploadSessionMeta(sessionId);
  const storage = createServiceSupabase().storage.from(BUCKET);
  const parts: Buffer[] = [];

  for (let index = 0; index < meta.chunk_total; index += 1) {
    const { data, error } = await storage.download(chunkObjectPath(sessionId, index));
    if (error || !data) {
      throw new Error(`Не хватает части загрузки ${index + 1} из ${meta.chunk_total}`);
    }
    parts.push(Buffer.from(await data.arrayBuffer()));
  }

  const buffer = Buffer.concat(parts);
  if (buffer.byteLength !== meta.bytes) {
    throw new Error("Размер собранного файла не совпадает с ожидаемым");
  }

  return { buffer, contentType: meta.content_type };
}

export async function removeStoryUploadSession(sessionId: string): Promise<void> {
  const id = assertStoryUploadSessionId(sessionId);
  const storage = createServiceSupabase().storage.from(BUCKET);
  const folder = sessionBase(id);
  const { data: listed, error: listError } = await storage.list(folder, { limit: 1000 });
  if (listError) {
    // Missing folder is fine (already cleaned or never created).
    return;
  }
  const paths = (listed ?? [])
    .map((entry) => entry.name)
    .filter((name) => typeof name === "string" && name.length > 0)
    .map((name) => `${folder}/${name}`);
  if (paths.length === 0) return;
  const { error } = await storage.remove(paths);
  if (error) throw error;
}
