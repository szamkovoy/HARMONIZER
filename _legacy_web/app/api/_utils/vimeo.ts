import type { PracticeRecommendation, PracticeVideoThumbnail } from "@shared/recommendation";

const VIMEO_API_BASE = "https://api.vimeo.com";
const VIMEO_ACCEPT = "application/vnd.vimeo.*+json;version=3.4";
const VIMEO_REVALIDATE_SEC = 60 * 60 * 24;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

type VimeoPictureSize = {
  width?: number;
  height?: number;
  link?: string;
};

function vimeoToken(): string {
  const token =
    process.env.VIMEO_ACCESS_TOKEN?.trim() ||
    process.env.vimeo_token?.trim() ||
    process.env.VIMEO_TOKEN?.trim();
  if (!token) {
    throw new Error("Missing Vimeo token. Set VIMEO_ACCESS_TOKEN or vimeo_token.");
  }
  return token;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number.parseInt(value, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
}

export function pickBestVimeoThumbnail(
  sizes: VimeoPictureSize[] | null | undefined,
  targetWidth: number,
): PracticeVideoThumbnail | null {
  const normalized = (sizes ?? [])
    .map((size) => ({
      url: typeof size.link === "string" ? size.link.trim() : "",
      width: typeof size.width === "number" ? size.width : 0,
      height: typeof size.height === "number" ? size.height : 0,
    }))
    .filter((size) => size.url && size.width > 0 && size.height > 0)
    .sort((a, b) => a.width - b.width);

  if (!normalized.length) return null;
  return normalized.find((size) => size.width >= targetWidth) ?? normalized[normalized.length - 1] ?? null;
}

async function vimeoGetJson<T>(path: string, attempt = 1): Promise<T> {
  const response = await fetch(`${VIMEO_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${vimeoToken()}`,
      Accept: VIMEO_ACCEPT,
    },
    next: { revalidate: VIMEO_REVALIDATE_SEC },
  });

  if (!response.ok) {
    if (RETRYABLE_STATUSES.has(response.status) && attempt < 4) {
      const retryDelayMs = parseRetryAfter(response.headers.get("Retry-After")) ?? 500 * attempt;
      await sleep(retryDelayMs);
      return vimeoGetJson<T>(path, attempt + 1);
    }
    if (response.status === 404) return {} as T;
    const message = await response.text().catch(() => response.statusText);
    throw new Error(`Vimeo API error ${response.status}: ${message.slice(0, 280)}`);
  }

  return response.json() as Promise<T>;
}

export async function fetchVimeoThumbnail(
  videoId: string,
  targetWidth = 200,
): Promise<PracticeVideoThumbnail | null> {
  const trimmedId = videoId.trim();
  if (!trimmedId) return null;
  const payload = await vimeoGetJson<{ pictures?: { sizes?: VimeoPictureSize[] | null } | null }>(
    `/videos/${encodeURIComponent(trimmedId)}?fields=pictures`,
  );
  return pickBestVimeoThumbnail(payload.pictures?.sizes, targetWidth);
}

export async function fetchVimeoThumbnailBatch(
  videoIds: string[],
  targetWidth = 200,
  concurrency = 6,
): Promise<Record<string, PracticeVideoThumbnail | null>> {
  const uniqueIds = [...new Set(videoIds.map((id) => id.trim()).filter(Boolean))];
  const result: Record<string, PracticeVideoThumbnail | null> = {};
  if (!uniqueIds.length) return result;

  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= uniqueIds.length) return;
      const videoId = uniqueIds[index]!;
      try {
        result[videoId] = await fetchVimeoThumbnail(videoId, targetWidth);
      } catch (error) {
        console.warn("[vimeo] thumbnail fetch failed", videoId, error instanceof Error ? error.message : String(error));
        result[videoId] = null;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, uniqueIds.length) }, () => worker()));
  return result;
}

export async function attachThumbnailToPracticeRecommendation<T extends PracticeRecommendation>(
  practice: T,
  targetWidth: number,
): Promise<T> {
  const video = practice.video;
  if (!video || video.provider !== "vimeo" || !video.externalId) return practice;
  const thumbnail = await fetchVimeoThumbnail(video.externalId, targetWidth);
  return {
    ...practice,
    video: {
      ...video,
      thumbnail,
    },
  };
}
