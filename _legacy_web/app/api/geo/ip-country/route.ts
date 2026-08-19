import { resolveIpCountry } from "../../_utils/ipCountry";
import { errorResponse, json, requireUserId } from "../../_utils/supabase";

/**
 * Country of the calling device (or its VPN egress) from Vercel geo headers,
 * with a public IP lookup fallback when the header is missing (local / some edges).
 *
 * Does not persist. `users.country_code` is GPS/Nominatim only; the client
 * uses this response ephemerally when that field is empty (cabinet gateway).
 */
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    await requireUserId(req);
    const result = await resolveIpCountry(req.headers);
    return json({
      country: result.country || null,
      source: result.source,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
