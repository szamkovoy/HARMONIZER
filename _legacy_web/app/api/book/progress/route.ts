import { createServiceSupabase, errorResponse, json, requireUserId } from "../../_utils/supabase";
import { hasActiveBookPurchase } from "../../account/bookOwnership";

const BOOK_ID = "yoga_wizards_path";
const BOOK_LOCALES = new Set(["ru", "en", "de", "fr", "it", "es", "pt", "nl"]);

export const runtime = "nodejs";

type ProgressRow = {
  locator: string;
  percent: number | null;
  chapter_label: string | null;
  snippet: string | null;
  href: string | null;
  updated_at: string;
};

function serializeProgress(row: ProgressRow) {
  return {
    locator: row.locator,
    percent: row.percent == null ? undefined : Number(row.percent),
    chapterLabel: row.chapter_label ?? undefined,
    snippet: row.snippet ?? undefined,
    href: row.href ?? undefined,
    updatedAt: row.updated_at,
  };
}

function parseLocale(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const locale = value.trim().toLowerCase();
  return BOOK_LOCALES.has(locale) ? locale : null;
}

/**
 * GET /api/book/progress?bookId=&locale=
 * PUT /api/book/progress  body: { bookId, locale, locator, percent?, chapterLabel?, snippet?, href?, updatedAt }
 * Last-write-wins by updatedAt.
 */
export async function GET(req: Request) {
  try {
    const userId = await requireUserId(req);
    const url = new URL(req.url);
    const bookId = (url.searchParams.get("bookId") ?? BOOK_ID).trim();
    const locale = parseLocale(url.searchParams.get("locale"));
    if (bookId !== BOOK_ID || !locale) {
      return json({ error: "invalid_params" }, { status: 400 });
    }

    const db = createServiceSupabase();
    const { data, error } = await db
      .from("book_reading_progress")
      .select("locator,percent,chapter_label,snippet,href,updated_at")
      .eq("user_id", userId)
      .eq("book_id", bookId)
      .eq("locale", locale)
      .maybeSingle();
    if (error) throw error;
    if (!data) return json({ progress: null });
    return json({ progress: serializeProgress(data as ProgressRow) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(req: Request) {
  try {
    const userId = await requireUserId(req);
    const body = (await req.json()) as Record<string, unknown>;
    const bookId = typeof body.bookId === "string" ? body.bookId.trim() : BOOK_ID;
    const locale = parseLocale(body.locale);
    const locator = typeof body.locator === "string" ? body.locator.trim() : "";
    if (bookId !== BOOK_ID || !locale || !locator) {
      return json({ error: "invalid_params" }, { status: 400 });
    }

    const db = createServiceSupabase();
    const owned = await hasActiveBookPurchase(db, userId);
    if (!owned) {
      return json({ error: "book_not_owned" }, { status: 403 });
    }

    const clientUpdatedAt =
      typeof body.updatedAt === "string" && body.updatedAt.trim()
        ? body.updatedAt.trim()
        : new Date().toISOString();
    const percent =
      typeof body.percent === "number" && Number.isFinite(body.percent)
        ? Math.max(0, Math.min(100, body.percent))
        : null;
    const chapterLabel =
      typeof body.chapterLabel === "string" && body.chapterLabel.trim()
        ? body.chapterLabel.trim()
        : null;
    const snippet =
      typeof body.snippet === "string" && body.snippet.trim() ? body.snippet.trim() : null;
    const href = typeof body.href === "string" && body.href.trim() ? body.href.trim() : null;

    const { data: existing, error: readError } = await db
      .from("book_reading_progress")
      .select("locator,percent,chapter_label,snippet,href,updated_at")
      .eq("user_id", userId)
      .eq("book_id", bookId)
      .eq("locale", locale)
      .maybeSingle();
    if (readError) throw readError;

    if (existing?.updated_at) {
      const serverMs = Date.parse(existing.updated_at);
      const clientMs = Date.parse(clientUpdatedAt);
      if (Number.isFinite(serverMs) && Number.isFinite(clientMs) && clientMs < serverMs) {
        return json({
          progress: serializeProgress(existing as ProgressRow),
          rejected: true,
        });
      }
    }

    const row = {
      user_id: userId,
      book_id: bookId,
      locale,
      locator,
      percent,
      chapter_label: chapterLabel,
      snippet,
      href,
      updated_at: clientUpdatedAt,
    };

    const { data, error } = await db
      .from("book_reading_progress")
      .upsert(row, { onConflict: "user_id,book_id,locale" })
      .select("locator,percent,chapter_label,snippet,href,updated_at")
      .single();
    if (error) throw error;

    return json({ progress: serializeProgress(data as ProgressRow), rejected: false });
  } catch (error) {
    return errorResponse(error);
  }
}
