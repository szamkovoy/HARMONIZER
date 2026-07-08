export type AdminPostPayload = {
  title?: string;
  body?: string;
  cover_url?: string | null;
  is_published?: boolean;
  published_at?: string | null;
};

/** Нормализация формы «создать публикацию»: заголовок обязателен, публикация датируется. */
export function postRowFromPayload(payload: AdminPostPayload) {
  const title = payload.title?.trim() ?? "";
  if (!title) {
    throw new Response(JSON.stringify({ error: "Заголовок публикации обязателен" }), { status: 400 });
  }
  const isPublished = payload.is_published ?? false;
  const publishedAt = payload.published_at ? new Date(payload.published_at) : isPublished ? new Date() : null;
  if (publishedAt && Number.isNaN(publishedAt.getTime())) {
    throw new Response(JSON.stringify({ error: "Некорректная дата публикации" }), { status: 400 });
  }
  return {
    title,
    body: payload.body ?? "",
    cover_url: payload.cover_url?.trim() || null,
    is_published: isPublished,
    published_at: publishedAt ? publishedAt.toISOString() : null,
  };
}

/** Частичное обновление; published_at проставляется при первом включении публикации. */
export function postUpdateFromPayload(payload: AdminPostPayload, current: { published_at: string | null }) {
  const update: Record<string, unknown> = {};
  if (payload.title !== undefined) {
    const title = payload.title.trim();
    if (!title) {
      throw new Response(JSON.stringify({ error: "Заголовок публикации обязателен" }), { status: 400 });
    }
    update.title = title;
  }
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
  if (Object.keys(update).length === 0) {
    throw new Response(JSON.stringify({ error: "Нет полей для обновления" }), { status: 400 });
  }
  return update;
}
