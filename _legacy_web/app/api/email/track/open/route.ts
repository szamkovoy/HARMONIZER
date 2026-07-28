import { after } from "next/server";

import {
  parseEmailTrackToken,
  recordFirstPartyTrackEvent,
  trackingPixelResponse,
} from "../../../_utils/emailFirstPartyTracking";
import { createServiceSupabase } from "../../../_utils/supabase";

export const runtime = "nodejs";

/** 1×1 open pixel — return GIF first, record in background. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const trackId = parseEmailTrackToken(url.searchParams.get("t"));
  if (trackId) {
    after(async () => {
      try {
        const db = createServiceSupabase();
        await recordFirstPartyTrackEvent(db, { trackId, kind: "opened" });
      } catch {
        /* never break the pixel */
      }
    });
  }
  return trackingPixelResponse();
}
