import { getCommunicatorApiBaseUrl } from "@/services/communicatorConfig";
import { getSupabaseAccessToken } from "@/services/supabase";

import { BOOK_ID, type BookLocale } from "./bookIds";

export type BookManifest = {
  bookId: string;
  locale: BookLocale;
  epubUrl: string;
  version: string;
  title: string;
  coverUrl: string | null;
};

/**
 * GET /api/book/manifest?locale= — requires ownership.
 * Returns null on network/auth errors; throws on 403/400 with a code.
 */
export async function fetchBookManifest(locale: BookLocale): Promise<BookManifest> {
  const accessToken = await getSupabaseAccessToken();
  if (!accessToken) {
    throw new Error("book_auth_required");
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(
      `${getCommunicatorApiBaseUrl()}/api/book/manifest?locale=${encodeURIComponent(locale)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: controller.signal,
      },
    );
    if (res.status === 403) throw new Error("book_not_owned");
    if (res.status === 400) throw new Error("invalid_locale");
    if (!res.ok) throw new Error(`book_manifest_http_${res.status}`);
    const data = (await res.json()) as {
      bookId?: string;
      locale?: string;
      epubUrl?: string;
      version?: string;
      title?: string;
      coverUrl?: string | null;
    };
    if (!data.epubUrl || !data.version) throw new Error("book_manifest_invalid");
    return {
      bookId: data.bookId ?? BOOK_ID,
      locale: (data.locale as BookLocale) ?? locale,
      epubUrl: data.epubUrl,
      version: String(data.version),
      title: data.title ?? "",
      coverUrl: data.coverUrl ?? null,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
