import { after } from "next/server";

import {
  parseEmailTrackToken,
  recordFirstPartyTrackEvent,
  safeClickRedirectUrl,
} from "../../../_utils/emailFirstPartyTracking";
import { createServiceSupabase } from "../../../_utils/supabase";

export const runtime = "nodejs";

/**
 * Click redirect for first-party marketing tracking.
 * Redirect immediately; persist the click in the background so the user
 * does not stare at a blank Vercel page while Supabase writes.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const dest = safeClickRedirectUrl(url.searchParams.get("u"));
  const trackId = parseEmailTrackToken(url.searchParams.get("t"));

  if (!dest) {
    return new Response("Bad link", { status: 400 });
  }

  if (trackId) {
    after(async () => {
      try {
        const db = createServiceSupabase();
        await recordFirstPartyTrackEvent(db, {
          trackId,
          kind: "clicked",
          clickUrl: dest,
        });
      } catch {
        /* tracking must never block navigation */
      }
    });
  }

  return Response.redirect(dest, 302);
}
