import { createServiceSupabase, errorResponse, json, requireUserId } from "../../_utils/supabase";
import { hasActiveBookPurchase } from "../../account/bookOwnership";

const BOOK_ID = "yoga_wizards_path";
const BOOK_LOCALES = new Set(["ru", "en", "de", "fr", "it", "es", "pt", "nl"]);

const BOOK_TITLES: Record<string, string> = {
  ru: "Йога — путь волшебника",
  en: "Yoga — the Way of Wisdom",
  de: "Yoga — der Weg der Weisheit",
  fr: "Yoga — la voie de la sagesse",
  it: "Yoga — la via della saggezza",
  es: "Yoga — el camino de la sabiduría",
  pt: "Yoga — o caminho da sabedoria",
  nl: "Yoga — de weg van wijsheid",
};

/**
 * CDN manifest for the EPUB reader (Phase B).
 * GET /api/book/manifest?locale=ru
 *   -> { bookId, locale, epubUrl, version, title, coverUrl }
 *
 * Env: BOOK_CDN_BASE_URL (e.g. https://zamkovoi.yoga/books/yoga_wizards_path),
 *      BOOK_EPUB_VERSION (e.g. 1).
 */
export const runtime = "nodejs";

function cdnBase(): string {
  const raw = (process.env.BOOK_CDN_BASE_URL ?? "").trim().replace(/\/$/, "");
  if (!raw) {
    throw new Error("BOOK_CDN_BASE_URL is not configured");
  }
  return raw;
}

function epubVersion(): string {
  const v = (process.env.BOOK_EPUB_VERSION ?? "1").trim();
  return v || "1";
}

export async function GET(req: Request) {
  try {
    const userId = await requireUserId(req);
    const db = createServiceSupabase();
    const owned = await hasActiveBookPurchase(db, userId);
    if (!owned) {
      return json({ error: "book_not_owned" }, { status: 403 });
    }

    const url = new URL(req.url);
    const locale = (url.searchParams.get("locale") ?? "").trim().toLowerCase();
    if (!BOOK_LOCALES.has(locale)) {
      return json({ error: "invalid_locale" }, { status: 400 });
    }

    const base = cdnBase();
    const version = epubVersion();
    // Layout on zamkovoi: /book/{locale}/book.epub (+ optional cover.jpg).
    // Cache busting uses BOOK_EPUB_VERSION in the client, not a /vN/ path segment.
    const epubUrl = `${base}/${locale}/book.epub`;
    const coverUrl = `${base}/${locale}/cover.jpg`;

    return json({
      bookId: BOOK_ID,
      locale,
      epubUrl,
      version,
      title: BOOK_TITLES[locale] ?? BOOK_TITLES.ru,
      coverUrl,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
