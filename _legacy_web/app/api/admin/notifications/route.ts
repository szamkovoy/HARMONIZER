import { asContentLocale } from "../../_utils/contentLocales";
import { createServiceSupabase, errorResponse, json, requireAdmin } from "../../_utils/supabase";
import { parseSegment, segmentLabel } from "./segment";
import { createAndSendNotification } from "./sendNotification";

export const runtime = "nodejs";
export const maxDuration = 120;

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

/** List notifications: ?page=&limit=50&user_id= */
export async function GET(req: Request) {
  try {
    await requireAdmin(req);
    const url = new URL(req.url);
    const { page, limit, offset } = parsePageLimit(url);
    const userId = url.searchParams.get("user_id")?.trim() || null;
    const db = createServiceSupabase();

    let idsFilter: string[] | null = null;
    if (userId) {
      const { data: deliveries, error: delErr } = await db
        .from("notification_deliveries")
        .select("notification_id")
        .eq("user_id", userId)
        .not("notification_id", "is", null);
      if (delErr) throw delErr;
      idsFilter = [
        ...new Set(
          (deliveries ?? [])
            .map((d) => d.notification_id as string | null)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      if (idsFilter.length === 0) {
        return json({
          notifications: [],
          page,
          limit,
          total: 0,
        });
      }
    }

    let query = db
      .from("notifications")
      .select(
        "id, title, body, title_i18n, body_i18n, link_url, segment, segment_label, recipient_count, push_sent_count, push_error_count, sent_at, created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false });

    if (idsFilter) {
      query = query.in("id", idsFilter);
    }

    const { data, error, count } = await query.range(offset, offset + limit - 1);
    if (error) throw error;

    return json({
      notifications: data ?? [],
      page,
      limit,
      total: count ?? 0,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

type PostPayload = {
  draft?: boolean;
  title?: string;
  body?: string;
  title_i18n?: Record<string, string>;
  body_i18n?: Record<string, string>;
  link_url?: string | null;
  segment?: string;
};

/**
 * draft:true → create row with sent_at=null (editor).
 * otherwise → create + send immediately (user-card quick push).
 */
export async function POST(req: Request) {
  try {
    await requireAdmin(req);
    const payload = (await req.json()) as PostPayload;
    const title = payload.title?.trim() ?? "";
    const body = payload.body?.trim() ?? "";
    const titleI18n = cleanI18nMap(payload.title_i18n);
    const bodyI18n = cleanI18nMap(payload.body_i18n);
    const db = createServiceSupabase();

    if (payload.draft === true) {
      const segmentRaw = payload.segment?.trim() || "all";
      const segment = parseSegment(segmentRaw);
      const displayTitle =
        title ||
        titleI18n.en ||
        Object.values(titleI18n).find((v) => v.trim()) ||
        "Новое уведомление";
      const { data: notification, error } = await db
        .from("notifications")
        .insert({
          title: title || displayTitle,
          body,
          title_i18n: titleI18n,
          body_i18n: bodyI18n,
          link_url: payload.link_url?.trim() || null,
          segment: segmentRaw,
          segment_label: await segmentLabel(db, segment),
          recipient_count: 0,
          sent_at: null,
        })
        .select("*")
        .single();
      if (error) throw error;
      return json({ notification });
    }

    const hasAnyTitle =
      Boolean(title) || Object.values(titleI18n).some((value) => value.trim());
    if (!hasAnyTitle) {
      return json(
        { error: "Заголовок уведомления обязателен хотя бы на одном языке" },
        { status: 400 },
      );
    }

    const result = await createAndSendNotification(db, {
      title,
      body,
      titleI18n,
      bodyI18n,
      linkUrl: payload.link_url?.trim() || null,
      segmentRaw: payload.segment?.trim() || "all",
    });
    return json(result);
  } catch (error) {
    const status = (error as Error & { status?: number }).status;
    if (status && error instanceof Error) {
      return json(
        {
          error: error.message,
          skipped_no_locale_copy: (error as Error & { skipped_no_locale_copy?: number })
            .skipped_no_locale_copy,
        },
        { status },
      );
    }
    return errorResponse(error);
  }
}
