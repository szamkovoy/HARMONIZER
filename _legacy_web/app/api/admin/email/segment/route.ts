import { parseStringRecord } from "../../../_utils/contentLocaleFallback";
import {
  parseEmailSegmentQuery,
  resolveCampaignRecipients,
  resolveEmailSegment,
} from "../../../_utils/emailSegment";
import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";

export const runtime = "nodejs";
export const maxDuration = 60;

type SegmentBody = {
  query?: unknown;
  sync?: boolean;
  /** When set with campaign copy fields — count = who would actually receive (exact locale). */
  subject?: string;
  html_body?: string;
  subject_i18n?: unknown;
  html_body_i18n?: unknown;
};

/**
 * Preview recipient count (+ countries).
 * With campaign copy in body: `count` = send-eligible (same rules as POST …/send).
 * Auto-syncs app users → email_contacts first.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const body = (await req.json()) as SegmentBody;
    const db = createServiceSupabase();
    if (body.sync !== false) {
      const { error: syncError } = await db.rpc("sync_email_contacts_from_users");
      if (syncError) throw syncError;
    }
    const query = parseEmailSegmentQuery(body.query);

    const hasCopy =
      typeof body.subject === "string" ||
      typeof body.html_body === "string" ||
      body.subject_i18n != null ||
      body.html_body_i18n != null;

    if (hasCopy) {
      const result = await resolveCampaignRecipients(db, query, {
        subject: typeof body.subject === "string" ? body.subject : "",
        htmlBody: typeof body.html_body === "string" ? body.html_body : "",
        subjectI18n: parseStringRecord(body.subject_i18n),
        htmlBodyI18n: parseStringRecord(body.html_body_i18n),
      });
      return json({
        count: result.eligible.length,
        segment_count: result.segmentCount,
        skipped_locale_count: result.skippedLocaleCount,
        countries: result.countries,
        no_audience: result.no_audience === true,
      });
    }

    const result = await resolveEmailSegment(db, query);
    return json({
      count: result.count,
      segment_count: result.count,
      skipped_locale_count: 0,
      countries: result.countries,
      no_audience: result.no_audience === true,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
