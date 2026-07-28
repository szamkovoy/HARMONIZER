import { asContentLocale } from "../../../_utils/contentLocales";
import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../../_utils/supabase";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 50;

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

function parsePageLimit(url: URL): { page: number; limit: number; offset: number } {
  const rawPage = Number(url.searchParams.get("page") ?? 1);
  const rawLimit = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(100, Math.floor(rawLimit))
      : DEFAULT_LIMIT;
  return { page, limit, offset: (page - 1) * limit };
}

/**
 * List campaigns (newest first).
 * `?limit=10` for pickers (no page → first page).
 * `?page=&limit=50&user_id=` for admin list.
 */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const url = new URL(req.url);
    const { page, limit, offset } = parsePageLimit(url);
    const userId = url.searchParams.get("user_id")?.trim() || null;
    const db = createServiceSupabase();

    let idsFilter: string[] | null = null;
    if (userId) {
      const { data: contact, error: contactErr } = await db
        .from("email_contacts")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();
      if (contactErr) throw contactErr;
      if (!contact?.id) {
        return json({ campaigns: [], page, limit, total: 0 });
      }
      const { data: sends, error: sendsErr } = await db
        .from("email_campaign_sends")
        .select("campaign_id")
        .eq("contact_id", contact.id);
      if (sendsErr) throw sendsErr;
      idsFilter = [
        ...new Set(
          (sends ?? [])
            .map((s) => s.campaign_id as string | null)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      if (idsFilter.length === 0) {
        return json({ campaigns: [], page, limit, total: 0 });
      }
    }

    let query = db
      .from("email_campaigns")
      .select(
        "id, status, name, subject, recipient_count, skipped_locale_count, sent_count, delivered_count, opened_count, clicked_count, bounced_count, complained_count, unsubscribed_count, error_count, sent_at, created_at, updated_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false });

    if (idsFilter) {
      query = query.in("id", idsFilter);
    }

    const { data, error, count } = await query.range(offset, offset + limit - 1);
    if (error) throw error;
    return json({
      campaigns: data ?? [],
      page,
      limit,
      total: count ?? 0,
    });
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
        segment_query: payload.segment_query ?? { all_contacts: true },
      })
      .select("*")
      .single();
    if (error) throw error;
    return json({ campaign: data });
  } catch (error) {
    return errorResponse(error);
  }
}
