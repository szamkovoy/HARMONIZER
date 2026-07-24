import {
  parseEmailSegmentQuery,
  resolveEmailSegment,
} from "../../../_utils/emailSegment";
import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Preview recipient count + countries.
 * Auto-syncs app users → email_contacts first so the list is never empty by omission.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const body = (await req.json()) as { query?: unknown; sync?: boolean };
    const db = createServiceSupabase();
    // Default: sync before count (cheap upsert; keeps «Все установившие» accurate).
    if (body.sync !== false) {
      const { error: syncError } = await db.rpc("sync_email_contacts_from_users");
      if (syncError) throw syncError;
    }
    const query = parseEmailSegmentQuery(body.query);
    const result = await resolveEmailSegment(db, query);
    return json({
      count: result.count,
      countries: result.countries,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
