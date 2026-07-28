import {
  parseEmailTrackToken,
  recordFirstPartyTrackEvent,
  safeClickRedirectUrl,
} from "../../../_utils/emailFirstPartyTracking";
import { createServiceSupabase } from "../../../_utils/supabase";

export const runtime = "nodejs";

/** Click redirect for first-party marketing tracking. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const dest = safeClickRedirectUrl(url.searchParams.get("u"));
  const trackId = parseEmailTrackToken(url.searchParams.get("t"));

  if (trackId && dest) {
    try {
      const db = createServiceSupabase();
      await recordFirstPartyTrackEvent(db, {
        trackId,
        kind: "clicked",
        clickUrl: dest,
      });
    } catch {
      /* still redirect */
    }
  }

  if (!dest) {
    return new Response("Bad link", { status: 400 });
  }
  return Response.redirect(dest, 302);
}
