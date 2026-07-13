import type { AppContentLocale } from "../../_utils/contentLocales";

export type AdminWebinarPayload = {
  title?: string;
  description?: string;
  starts_at?: string;
  join_url?: string | null;
  /** @deprecated Prefer linked posts.kind=webinar_recording; kept for transition. */
  recording_url?: string | null;
  /** Announce published (home banner + public read). */
  is_published?: boolean;
  cover_url?: string | null;
  title_i18n?: Record<string, string>;
  description_i18n?: Record<string, string>;
  cover_url_i18n?: Record<string, string | null>;
};

export type AdminWebinarRecordingPayload = {
  title?: string;
  body?: string;
  cover_url?: string | null;
  is_published?: boolean;
  title_i18n?: Record<string, string>;
  body_i18n?: Record<string, string>;
  cover_url_i18n?: Record<string, string | null>;
};

function badRequest(message: string): never {
  throw new Response(JSON.stringify({ error: message }), { status: 400 });
}

function parseStartsAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) badRequest("Некорректные дата и время вебинара");
  return date.toISOString();
}

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

/** Нормализация формы «создать вебинар»: заголовок и дата обязательны. */
export function webinarRowFromPayload(payload: AdminWebinarPayload) {
  const title = payload.title?.trim() ?? "";
  const titleI18n = trimmedRecord(payload.title_i18n);
  if (!hasAnyTitle(title, titleI18n)) badRequest("Название вебинара обязательно хотя бы на одном языке");
  if (!payload.starts_at) badRequest("Дата и время вебинара обязательны");
  const descriptionI18n = trimmedRecord(payload.description_i18n);
  const coverUrlI18n = payload.cover_url_i18n ?? {};
  const hasI18n =
    Object.keys(titleI18n).length > 0 ||
    Object.keys(descriptionI18n).length > 0 ||
    Object.keys(coverUrlI18n).some((key) => Boolean(coverUrlI18n[key]));

  return {
    title,
    description: payload.description ?? "",
    starts_at: parseStartsAt(payload.starts_at),
    join_url: payload.join_url?.trim() || null,
    recording_url: payload.recording_url?.trim() || null,
    is_published: payload.is_published ?? false,
    cover_url: payload.cover_url?.trim() || null,
    title_i18n: titleI18n,
    description_i18n: descriptionI18n,
    cover_url_i18n: coverUrlI18n,
    ...(hasI18n ? { translations_updated_at: new Date().toISOString() } : {}),
  };
}

export function webinarUpdateFromPayload(payload: AdminWebinarPayload) {
  const update: Record<string, unknown> = {};
  if (payload.title !== undefined) {
    const title = payload.title.trim();
    if (!title && !payload.title_i18n) badRequest("Название вебинара обязательно");
    update.title = title;
  }
  if (payload.description !== undefined) update.description = payload.description;
  if (payload.starts_at !== undefined) update.starts_at = parseStartsAt(payload.starts_at);
  if (payload.join_url !== undefined) update.join_url = payload.join_url?.trim() || null;
  if (payload.recording_url !== undefined) update.recording_url = payload.recording_url?.trim() || null;
  if (payload.is_published !== undefined) update.is_published = payload.is_published;
  if (payload.cover_url !== undefined) update.cover_url = payload.cover_url?.trim() || null;
  if (payload.title_i18n !== undefined) update.title_i18n = trimmedRecord(payload.title_i18n);
  if (payload.description_i18n !== undefined) update.description_i18n = trimmedRecord(payload.description_i18n);
  if (payload.cover_url_i18n !== undefined) update.cover_url_i18n = payload.cover_url_i18n;

  if (
    payload.title_i18n !== undefined ||
    payload.description_i18n !== undefined ||
    payload.cover_url_i18n !== undefined
  ) {
    update.translations_updated_at = new Date().toISOString();
  }

  if (Object.keys(update).length === 0) badRequest("Нет полей для обновления");
  return update;
}

export function recordingPostRowFromPayload(
  payload: AdminWebinarRecordingPayload,
  webinarId: string,
  createdBy: string,
) {
  const title = payload.title?.trim() ?? "";
  const titleI18n = trimmedRecord(payload.title_i18n);
  if (!hasAnyTitle(title, titleI18n)) badRequest("Название записи обязательно хотя бы на одном языке");
  const isPublished = payload.is_published ?? false;
  const bodyI18n = trimmedRecord(payload.body_i18n);
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
    published_at: isPublished ? new Date().toISOString() : null,
    title_i18n: titleI18n,
    body_i18n: bodyI18n,
    cover_url_i18n: coverUrlI18n,
    kind: "webinar_recording" as const,
    webinar_id: webinarId,
    created_by: createdBy,
    ...(hasI18n ? { translations_updated_at: new Date().toISOString() } : {}),
  };
}

export function recordingPostUpdateFromPayload(
  payload: AdminWebinarRecordingPayload,
  current: { published_at: string | null },
) {
  const update: Record<string, unknown> = {};
  if (payload.title !== undefined) {
    const title = payload.title.trim();
    if (!title && !payload.title_i18n) badRequest("Название записи обязательно");
    update.title = title;
  }
  if (payload.body !== undefined) update.body = payload.body;
  if (payload.cover_url !== undefined) update.cover_url = payload.cover_url?.trim() || null;
  if (payload.title_i18n !== undefined) update.title_i18n = trimmedRecord(payload.title_i18n);
  if (payload.body_i18n !== undefined) update.body_i18n = trimmedRecord(payload.body_i18n);
  if (payload.cover_url_i18n !== undefined) update.cover_url_i18n = payload.cover_url_i18n;
  if (payload.is_published !== undefined) {
    update.is_published = payload.is_published;
    if (payload.is_published && !current.published_at) {
      update.published_at = new Date().toISOString();
    }
  }
  if (
    payload.title_i18n !== undefined ||
    payload.body_i18n !== undefined ||
    payload.cover_url_i18n !== undefined
  ) {
    update.translations_updated_at = new Date().toISOString();
  }
  if (Object.keys(update).length === 0) badRequest("Нет полей для обновления");
  return update;
}

export type { AppContentLocale };
