export interface PracticeVideoThumbnail {
  url: string;
  width: number;
  height: number;
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function normalizePracticeVideoThumbnail(value: unknown): PracticeVideoThumbnail | null {
  const record = objectRecord(value);
  if (!record) return null;

  const url = typeof record.url === "string" ? record.url.trim() : "";
  const width = positiveNumber(record.width);
  const height = positiveNumber(record.height);
  if (!url || width == null || height == null) return null;

  return { url, width, height };
}

export function readPracticeVideoThumbnailFromParams(params: unknown): PracticeVideoThumbnail | null {
  const record = objectRecord(params);
  if (!record) return null;

  return (
    normalizePracticeVideoThumbnail(record.video_thumbnail) ??
    normalizePracticeVideoThumbnail(record.thumbnail) ??
    null
  );
}

export function writePracticeVideoThumbnailToParams(
  params: unknown,
  thumbnail: PracticeVideoThumbnail | null,
): Record<string, unknown> {
  const base = objectRecord(params) ?? {};
  if (!thumbnail) {
    const { video_thumbnail: _removed, ...rest } = base;
    return rest;
  }

  return {
    ...base,
    video_thumbnail: {
      url: thumbnail.url,
      width: thumbnail.width,
      height: thumbnail.height,
    },
  };
}
