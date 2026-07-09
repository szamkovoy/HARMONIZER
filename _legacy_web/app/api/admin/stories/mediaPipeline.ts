import ffmpegPath from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { accessSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import sharp from "sharp";

export const STORY_IMAGE_OUTPUT = { width: 1080, height: 1920, quality: 82 } as const;
export const STORY_THUMB_SIZE = 160;
export const STORY_VIDEO_COVER_OUTPUT = { width: 1080, height: 1920, quality: 82 } as const;
export const STORY_IMAGE_MAX_BYTES = 30 * 1024 * 1024;
export const STORY_VIDEO_MAX_BYTES = 45 * 1024 * 1024;
export const STORY_VIDEO_MAX_DURATION_SEC = 45;
export const STORY_VIDEO_TARGET_FPS = 30;
export const STORY_VIDEO_TARGET_MAXRATE = "7000k";
export const STORY_VIDEO_TARGET_BUFSIZE = "14000k";

const requireForRuntime = createRequire(import.meta.url);

type StorySourceKind = "image" | "video";

type OutputAsset = {
  buffer: Buffer;
  contentType: string;
  ext: string;
};

export type ProcessedStoryMedia =
  | {
      kind: "image";
      main: OutputAsset;
      thumbnail: OutputAsset;
      durationMs: null;
    }
  | {
      kind: "video";
      main: OutputAsset;
      cover: OutputAsset;
      thumbnail: OutputAsset;
      durationMs: number;
    };

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_MIME_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

function requireBinaryPath(value: string | null | undefined, name: string): string {
  if (!value) throw new Error(`${name} binary is unavailable`);
  return value;
}

function resolvePackageBinary(packageName: string, relativePathParts: string[], fallback: string | null | undefined, name: string): string {
  const candidates = [
    fallback ?? "",
    (() => {
      try {
        const pkgJsonPath = requireForRuntime.resolve(`${packageName}/package.json`);
        return join(dirname(pkgJsonPath), ...relativePathParts);
      } catch {
        return "";
      }
    })(),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      accessSync(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error(`${name} binary is unavailable`);
}

function storySourceKindFromMime(contentType: string): StorySourceKind {
  if (IMAGE_MIME_TYPES.has(contentType)) return "image";
  if (VIDEO_MIME_TYPES.has(contentType)) return "video";
  throw new Error(`Неподдерживаемый тип файла сторис: ${contentType || "не указан"}`);
}

export function validateStoryUploadPath(path: string): string {
  const trimmed = path.trim().replace(/^\/+/, "");
  if (!trimmed.startsWith("tmp/stories/")) {
    throw new Error("Временный путь сторис должен начинаться с tmp/stories/");
  }
  if (trimmed.includes("..")) {
    throw new Error("Некорректный временный путь сторис");
  }
  return trimmed;
}

export function assertStoryUploadSize(kind: StorySourceKind, bytes: number): void {
  const limit = kind === "image" ? STORY_IMAGE_MAX_BYTES : STORY_VIDEO_MAX_BYTES;
  if (bytes > limit) {
    const humanLimit = kind === "image" ? "30 МБ" : "45 МБ";
    throw new Error(`Файл слишком большой для сторис. Лимит: ${humanLimit}.`);
  }
}

export function storyUploadKindFromMime(contentType: string): StorySourceKind {
  return storySourceKindFromMime(contentType);
}

export function storyTempExtFromMime(contentType: string): string {
  const ext = EXT_BY_MIME[contentType];
  if (!ext) throw new Error(`Не удалось определить расширение для ${contentType}`);
  return ext;
}

export function buildProcessedStoryPath(kind: "main" | "cover" | "thumb", ext: string): string {
  const datePrefix = new Date().toISOString().slice(0, 10);
  return `processed/stories/${datePrefix}/${crypto.randomUUID()}-${kind}.${ext}`;
}

async function runBinary(command: string, args: string[]): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stderr: Buffer[] = [];

    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(Buffer.concat(stderr).toString("utf8") || `${command} exited with code ${code}`));
    });
  });

  return "";
}

async function runJsonBinary(command: string, args: string[]): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString("utf8") || `${command} exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(stdout).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function inspectVideo(sourcePath: string): Promise<{ durationSec: number }> {
  const ffprobePath = resolvePackageBinary(
    "ffprobe-static",
    ["bin", process.platform, process.arch, process.platform === "win32" ? "ffprobe.exe" : "ffprobe"],
    ffprobe.path,
    "ffprobe",
  );
  const payload = (await runJsonBinary(ffprobePath, [
    "-v",
    "quiet",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    sourcePath,
  ])) as {
    format?: { duration?: string };
  };

  const durationSec = Number(payload.format?.duration ?? "0");
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error("Не удалось определить длительность видео сторис");
  }
  return { durationSec };
}

async function processImage(input: Buffer): Promise<ProcessedStoryMedia> {
  const normalized = sharp(input, { failOn: "none" }).rotate();
  const mainBuffer = await normalized
    .resize(STORY_IMAGE_OUTPUT.width, STORY_IMAGE_OUTPUT.height, {
      fit: "cover",
      position: "centre",
    })
    .jpeg({ quality: STORY_IMAGE_OUTPUT.quality, mozjpeg: true })
    .toBuffer();

  const thumbnailBuffer = await sharp(mainBuffer)
    .resize(STORY_THUMB_SIZE, STORY_THUMB_SIZE, { fit: "cover", position: "centre" })
    .jpeg({ quality: 72, mozjpeg: true })
    .toBuffer();

  return {
    kind: "image",
    main: { buffer: mainBuffer, contentType: "image/jpeg", ext: "jpg" },
    thumbnail: { buffer: thumbnailBuffer, contentType: "image/jpeg", ext: "jpg" },
    durationMs: null,
  };
}

async function processVideo(input: Buffer, sourceExt: string): Promise<ProcessedStoryMedia> {
  const ffmpeg = resolvePackageBinary(
    "ffmpeg-static",
    [process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"],
    ffmpegPath,
    "ffmpeg",
  );
  const dir = await mkdtemp(join(tmpdir(), "harmonizer-story-"));
  const sourcePath = join(dir, `source.${sourceExt}`);
  const mainPath = join(dir, "story.mp4");
  const coverPath = join(dir, "cover.jpg");

  try {
    await writeFile(sourcePath, input);
    const { durationSec } = await inspectVideo(sourcePath);
    if (durationSec > STORY_VIDEO_MAX_DURATION_SEC) {
      throw new Error(`Видео сторис не должно быть длиннее ${STORY_VIDEO_MAX_DURATION_SEC} секунд.`);
    }

    await runBinary(ffmpeg, [
      "-y",
      "-i",
      sourcePath,
      "-vf",
      `scale=${STORY_VIDEO_COVER_OUTPUT.width}:${STORY_VIDEO_COVER_OUTPUT.height}:force_original_aspect_ratio=increase,crop=${STORY_VIDEO_COVER_OUTPUT.width}:${STORY_VIDEO_COVER_OUTPUT.height},fps=${STORY_VIDEO_TARGET_FPS},format=yuv420p`,
      "-c:v",
      "libx264",
      "-profile:v",
      "high",
      "-level",
      "4.1",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-maxrate",
      STORY_VIDEO_TARGET_MAXRATE,
      "-bufsize",
      STORY_VIDEO_TARGET_BUFSIZE,
      // Closed GOP every 1s — safer seeking / first-frame decode on mobile.
      "-g",
      String(STORY_VIDEO_TARGET_FPS),
      "-keyint_min",
      String(STORY_VIDEO_TARGET_FPS),
      "-sc_threshold",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "44100",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      mainPath,
    ]);

    // Cover from the already-encoded story.mp4 (not the raw source), so the
    // poster matches the first live frame the client will play.
    await runBinary(ffmpeg, [
      "-y",
      "-ss",
      "0",
      "-i",
      mainPath,
      "-frames:v",
      "1",
      "-q:v",
      "3",
      coverPath,
    ]);

    const mainBuffer = await readFile(mainPath);
    const coverBuffer = await readFile(coverPath);
    const thumbnailBuffer = await sharp(coverBuffer)
      .resize(STORY_THUMB_SIZE, STORY_THUMB_SIZE, { fit: "cover", position: "centre" })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer();

    return {
      kind: "video",
      main: { buffer: mainBuffer, contentType: "video/mp4", ext: "mp4" },
      cover: { buffer: coverBuffer, contentType: "image/jpeg", ext: "jpg" },
      thumbnail: { buffer: thumbnailBuffer, contentType: "image/jpeg", ext: "jpg" },
      durationMs: Math.round(durationSec * 1000),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function processStoryMedia(input: Buffer, contentType: string): Promise<ProcessedStoryMedia> {
  const kind = storySourceKindFromMime(contentType);
  assertStoryUploadSize(kind, input.byteLength);
  if (kind === "image") return processImage(input);
  return processVideo(input, storyTempExtFromMime(contentType));
}
