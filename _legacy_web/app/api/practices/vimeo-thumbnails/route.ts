import { errorResponse } from "@legacy/app/api/_utils/supabase";
import { fetchVimeoThumbnailBatch } from "@legacy/app/api/_utils/vimeo";

export const runtime = "nodejs";

type Body = {
  videoIds?: unknown;
  targetWidth?: unknown;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const videoIds = Array.isArray(body.videoIds)
      ? body.videoIds
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter(Boolean)
          .slice(0, 24)
      : [];
    if (!videoIds.length) {
      return Response.json({ thumbnails: {} }, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
    }

    const requestedWidth = typeof body.targetWidth === "number" && Number.isFinite(body.targetWidth) ? body.targetWidth : 200;
    const targetWidth = Math.max(80, Math.min(400, Math.round(requestedWidth)));
    const thumbnails = await fetchVimeoThumbnailBatch(videoIds, targetWidth);

    return Response.json(
      { thumbnails },
      {
        headers: {
          "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
        },
      },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
