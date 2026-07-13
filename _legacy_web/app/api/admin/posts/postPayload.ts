import { type AppContentLocale } from "../../_utils/contentLocales";

export type AdminPostPayload = {
  title?: string;
  body?: string;
  cover_url?: string | null;
  is_published?: boolean;
  published_at?: string | null;
  /** Translated titles keyed by locale (en/de/fr/it/es/pt/nl). */
  title_i18n?: Record<string, string>;
  /** Translated bodies keyed by locale. */
  body_i18n?: Record<string, string>;
  /** Per-locale cover URLs. */
  cover_url_i18n?: Record<string, string | null>;
};

function trimmedRecord(input: Record<string, string> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input) return out;
  for (const [key, value] of Object.entries(input)) {
    const text = value.trim();
    if (text) out[key] = text;
  }
  return out;
}

function hasAnyTitle(title: string, titleI18n: Record<string, string>): boolean {
  if (title.trim()) return true;
  return Object.values(titleI18n).some((value) => value.trim().length > 0);
}

/** Create: at least one locale title required; RU columns may be empty for non-RU-only videos. */
export function postRowFromPayload(payload: AdminPostPayload) {
  const title = payload.title?.trim() ?? "";
  const titleI18n = trimmedRecord(payload.title_i18n);
  const bodyI18n = trimmedRecord(payload.body_i18n);
  if (!hasAnyTitle(title, titleI18n)) {
    throw new Response(JSON.stringify({ error: "Заголовок видео обязателен хотя бы на одном языке" }), { status: 400 });
  }
  const isPublished = payload.is_published ?? false;
  const publishedAt = payload.published_at ? new Date(payload.published_at) : isPublished ? new Date() : null;
  if (publishedAt && Number.isNaN(publishedAt.getTime())) {
    throw new Response(JSON.stringify({ error: "Некорректная дата публикации" }), { status: 400 });
  }
  const coverUrlI18n = payload.cover_url_i18n ?? {};
  const hasI18n =
    Object.keys(titleI18n).length > 0 ||
    Object.keys(bodyI18n).length > 0 ||
    Object.keys(coverUrlI18n).some((key) => Boolean(coverUrlI18n[key]));

  return {
    title,
    body: payload.body ?? "",
    cover_url: payload.cover_url?.trim() || null,
    is_published: isPublished,
    published_at: publishedAt ? publishedAt.toISOString() : null,
    title_i18n: titleI18n,
    body_i18n: bodyI18n,
    cover_url_i18n: coverUrlI18n,
    ...(hasI18n ? { translations_updated_at: new Date().toISOString() } : {}),
  };
}

/** Partial update; published_at set on first publish. Empty RU title allowed if i18n titles remain. */
export function postUpdateFromPayload(payload: AdminPostPayload, current: { published_at: string | null; title?: string; title_i18n?: unknown }) {
  const update: Record<string, unknown> = {};
  const nextTitle = payload.title !== undefined ? payload.title.trim() : (current.title ?? "");
  const nextTitleI18n =
    payload.title_i18n !== undefined
      ? trimmedRecord(payload.title_i18n)
      : trimmedRecord((current.title_i18n as Record<string, string> | undefined) ?? undefined);

  if (payload.title !== undefined || payload.title_i18n !== undefined) {
    if (!hasAnyTitle(nextTitle, nextTitleI18n)) {
      throw new Response(JSON.stringify({ error: "Заголовок видео обязателен хотя бы на одном языке" }), { status: 400 });
    }
  }

  if (payload.title !== undefined) update.title = nextTitle;
  if (payload.body !== undefined) update.body = payload.body;
  if (payload.cover_url !== undefined) update.cover_url = payload.cover_url?.trim() || null;
  if (payload.published_at !== undefined) {
    update.published_at = payload.published_at ? new Date(payload.published_at).toISOString() : null;
  }
  if (payload.is_published !== undefined) {
    update.is_published = payload.is_published;
    if (payload.is_published && !current.published_at && payload.published_at === undefined) {
      update.published_at = new Date().toISOString();
    }
  }
  if (payload.title_i18n !== undefined) update.title_i18n = nextTitleI18n;
  if (payload.body_i18n !== undefined) update.body_i18n = trimmedRecord(payload.body_i18n);
  if (payload.cover_url_i18n !== undefined) update.cover_url_i18n = payload.cover_url_i18n;

  if (
    payload.title_i18n !== undefined ||
    payload.body_i18n !== undefined ||
    payload.cover_url_i18n !== undefined
  ) {
    update.translations_updated_at = new Date().toISOString();
  }

  if (Object.keys(update).length === 0) {
    throw new Response(JSON.stringify({ error: "Нет полей для обновления" }), { status: 400 });
  }
  return update;
}

export { adminPostDisplayTitle } from "../../../admin/posts/_lib/adminPostDisplayTitle";

export type { AppContentLocale };
