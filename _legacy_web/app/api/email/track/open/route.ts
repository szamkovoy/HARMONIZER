import { after } from "next/server";

import { parseEmailTrackTokenEdge, recordEmailOpen, trackingPixelResponse } from "../../../_utils/emailOpenTrack";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * 1×1 open pixel. The GIF is returned before any database work.
 * Recording is one PostgREST RPC (`record_first_party_email_open`).
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t");
  if (token) {
    after(async () => {
      try {
        const trackId = await parseEmailTrackTokenEdge(token);
        if (!trackId) return;
        await recordEmailOpen(trackId);
      } catch {
        /* never break the pixel */
      }
    });
  }
  return trackingPixelResponse();
}
