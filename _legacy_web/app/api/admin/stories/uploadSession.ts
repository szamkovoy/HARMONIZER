import { constants as fsConstants } from "node:fs";
import { accessSync, existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Signed Storage uploads hit the Supabase global limit (often 50 MiB). Larger raw files go via chunked API. */
export const STORY_DIRECT_STORAGE_UPLOAD_MAX_BYTES = 45 * 1024 * 1024;
export const STORY_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;

const SESSION_DIR = join(tmpdir(), "harmonizer-story-upload");
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

function sessionPath(sessionId: string): string {
  return join(SESSION_DIR, assertStoryUploadSessionId(sessionId));
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

  const dir = sessionPath(sessionId);
  await mkdir(dir, { recursive: true });

  const metaPath = join(dir, "meta.json");
  if (chunkIndex === 0) {
    const meta: StoryUploadSessionMeta = { content_type: contentType, chunk_total: chunkTotal, bytes };
    await writeFile(metaPath, JSON.stringify(meta));
  } else {
    const meta = await readStoryUploadSessionMeta(sessionId);
    if (meta.chunk_total !== chunkTotal || meta.bytes !== bytes || meta.content_type !== contentType) {
      throw new Error("Метаданные сессии загрузки не совпадают");
    }
  }

  await writeFile(join(dir, `chunk-${String(chunkIndex).padStart(4, "0")}`), chunk);
}

export async function readStoryUploadSessionMeta(sessionId: string): Promise<StoryUploadSessionMeta> {
  const metaPath = join(sessionPath(sessionId), "meta.json");
  if (!existsSync(metaPath)) {
    throw new Error("Сессия загрузки не найдена или ещё не инициализирована");
  }
  const raw = JSON.parse(await readFile(metaPath, "utf8")) as StoryUploadSessionMeta;
  if (!raw.content_type || !raw.chunk_total || !raw.bytes) {
    throw new Error("Повреждённые метаданные сессии загрузки");
  }
  return raw;
}

export async function assembleStoryUploadSession(sessionId: string): Promise<{ buffer: Buffer; contentType: string }> {
  const dir = sessionPath(sessionId);
  const meta = await readStoryUploadSessionMeta(sessionId);
  const parts: Buffer[] = [];

  for (let index = 0; index < meta.chunk_total; index += 1) {
    const partPath = join(dir, `chunk-${String(index).padStart(4, "0")}`);
    if (!existsSync(partPath)) {
      throw new Error(`Не хватает части загрузки ${index + 1} из ${meta.chunk_total}`);
    }
    parts.push(await readFile(partPath));
  }

  const buffer = Buffer.concat(parts);
  if (buffer.byteLength !== meta.bytes) {
    throw new Error("Размер собранного файла не совпадает с ожидаемым");
  }

  return { buffer, contentType: meta.content_type };
}

export async function removeStoryUploadSession(sessionId: string): Promise<void> {
  const dir = sessionPath(sessionId);
  if (!existsSync(dir)) return;
  await rm(dir, { recursive: true, force: true });
}

export async function listStoryUploadSessions(): Promise<string[]> {
  if (!existsSync(SESSION_DIR)) return [];
  const entries = await readdir(SESSION_DIR, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

export function storyUploadSessionDirExists(sessionId: string): boolean {
  const dir = sessionPath(sessionId);
  if (!existsSync(dir)) return false;
  try {
    accessSync(dir, fsConstants.R_OK | fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}
