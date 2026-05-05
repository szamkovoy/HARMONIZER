import { getPracticeVimeoThumbnailsUrl } from "@/services/communicatorConfig";
import type { PracticeVideoThumbnail } from "@/modules/practices/core/types";

const thumbnailCache = new Map<string, PracticeVideoThumbnail | null>();

function cacheKey(videoId: string, targetWidth: number): string {
  return `${videoId}:${targetWidth}`;
}

async function fetchViaBackend(params: {
  videoIds: string[];
  targetWidth: number;
  signal?: AbortSignal;
}): Promise<Record<string, PracticeVideoThumbnail | null>> {
  const response = await fetch(getPracticeVimeoThumbnailsUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      videoIds: params.videoIds,
      targetWidth: params.targetWidth,
    }),
    signal: params.signal,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(message || `Failed to fetch practice thumbnails (${response.status})`);
  }

  const payload = (await response.json()) as {
    thumbnails?: Record<string, PracticeVideoThumbnail | null>;
  };
  return payload.thumbnails ?? {};
}

export async function fetchPracticeVimeoThumbnail(params: {
  videoId: string;
  targetWidth: number;
  signal?: AbortSignal;
}): Promise<PracticeVideoThumbnail | null> {
  const videoId = params.videoId.trim();
  if (!videoId) return null;

  const key = cacheKey(videoId, params.targetWidth);
  if (thumbnailCache.has(key)) return thumbnailCache.get(key) ?? null;

  const response = await fetch(
    `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(`https://vimeo.com/${videoId}`)}&width=${params.targetWidth}`,
    {
      signal: params.signal,
    },
  );
  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText);
    throw new Error(message || `Vimeo oEmbed failed (${response.status})`);
  }

  const payload = (await response.json()) as {
    thumbnail_url?: string;
    thumbnail_width?: number;
    thumbnail_height?: number;
  };
  const thumbnail =
    payload.thumbnail_url && payload.thumbnail_width && payload.thumbnail_height
      ? {
          url: payload.thumbnail_url,
          width: payload.thumbnail_width,
          height: payload.thumbnail_height,
        }
      : null;
  thumbnailCache.set(key, thumbnail);
  return thumbnail;
}

export async function fetchPracticeVimeoThumbnails(params: {
  videoIds: string[];
  targetWidth: number;
  signal?: AbortSignal;
}): Promise<Record<string, PracticeVideoThumbnail | null>> {
  const uniqueIds = [...new Set(params.videoIds.map((id) => id.trim()).filter(Boolean))];
  if (!uniqueIds.length) return {};

  try {
    const thumbnails = await fetchViaBackend({
      videoIds: uniqueIds,
      targetWidth: params.targetWidth,
      signal: params.signal,
    });
    for (const [videoId, thumbnail] of Object.entries(thumbnails)) {
      thumbnailCache.set(cacheKey(videoId, params.targetWidth), thumbnail ?? null);
    }
    return thumbnails;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const routeMissing = /404|This page could not be found|<!DOCTYPE html>/i.test(message);
    if (!routeMissing) throw error;
  }

  const entries = await Promise.all(
    uniqueIds.map(async (videoId) => [videoId, await fetchPracticeVimeoThumbnail({
      videoId,
      targetWidth: params.targetWidth,
      signal: params.signal,
    })] as const),
  );
  return Object.fromEntries(entries);
}
