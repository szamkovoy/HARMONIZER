import { asContentLocale } from "../../../_utils/contentLocales";
import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";

export const runtime = "nodejs";

function cleanI18nMap(raw: Record<string, string> | undefined): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "ru") continue;
    const locale = asContentLocale(key);
    const text = typeof value === "string" ? value.trim() : "";
    if (locale && text) out[locale] = text;
  }
  return out;
}

/** List campaigns (newest first). */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const { data, error } = await createServiceSupabase()
      .from("email_campaigns")
      .select(
        "id, status, name, subject, recipient_count, skipped_locale_count, sent_count, delivered_count, opened_count, clicked_count, bounced_count, complained_count, unsubscribed_count, error_count, sent_at, created_at, updated_at",
      )
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return json({ campaigns: data ?? [] });
  } catch (error) {
    return errorResponse(error);
  }
}

type CreatePayload = {
  name?: string;
  subject?: string;
  html_body?: string;
  subject_i18n?: Record<string, string>;
  html_body_i18n?: Record<string, string>;
  blocks_i18n?: Record<string, unknown>;
  segment_query?: Record<string, unknown>;
};

/** Create draft campaign. */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const payload = (await req.json()) as CreatePayload;
    const subject = payload.subject?.trim() ?? "";
    const htmlBody = payload.html_body?.trim() ?? "";
    const subjectI18n = cleanI18nMap(payload.subject_i18n);
    const htmlBodyI18n = cleanI18nMap(payload.html_body_i18n);

    const { data, error } = await createServiceSupabase()
      .from("email_campaigns")
      .insert({
        status: "draft",
        name: payload.name?.trim() ?? "",
        subject,
        html_body: htmlBody,
        subject_i18n: subjectI18n,
        html_body_i18n: htmlBodyI18n,
        blocks_i18n: payload.blocks_i18n ?? {},
        segment_query: payload.segment_query ?? { all_installed: true },
      })
      .select("*")
      .single();
    if (error) throw error;
    return json({ campaign: data });
  } catch (error) {
    return errorResponse(error);
  }
}
