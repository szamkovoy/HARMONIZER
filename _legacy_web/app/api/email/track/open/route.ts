import {
  parseEmailTrackToken,
  recordFirstPartyTrackEvent,
  trackingPixelResponse,
} from "../../../_utils/emailFirstPartyTracking";
import { createServiceSupabase } from "../../../_utils/supabase";

export const runtime = "nodejs";

/** 1×1 open pixel for first-party marketing tracking. */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const trackId = parseEmailTrackToken(url.searchParams.get("t"));
    if (trackId) {
      const db = createServiceSupabase();
      await recordFirstPartyTrackEvent(db, { trackId, kind: "opened" });
    }
  } catch {
    /* still return pixel — never break the email image */
  }
  return trackingPixelResponse();
}
