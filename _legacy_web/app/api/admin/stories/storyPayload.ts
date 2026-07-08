export type AdminStoryPayload = {
  kind?: "image" | "video";
  image_url?: string | null;
  video_url?: string | null;
  cover_url?: string | null;
  thumbnail_url?: string | null;
  caption?: string;
  publish_at?: string | null;
  expires_at?: string | null;
  is_evergreen?: boolean;
  is_published?: boolean;
  order_hint?: number;
};

const HOUR_MS = 3_600_000;

export function storyRowFromPayload(body: AdminStoryPayload) {
  const kind = body.kind === "video" ? "video" : "image";
  const mediaUrl = kind === "video" ? body.video_url : body.image_url;
  if (!mediaUrl?.trim()) {
    throw new Response(JSON.stringify({ error: "Не загружен медиафайл сторис" }), { status: 400 });
  }
  const publishAt = body.publish_at ? new Date(body.publish_at) : new Date();
  if (Number.isNaN(publishAt.getTime())) {
    throw new Response(JSON.stringify({ error: "Некорректная дата публикации" }), { status: 400 });
  }
  // Контракт продукта: сторис живёт 24 часа, если админ явно не задал иное.
  const expiresAt = body.expires_at ? new Date(body.expires_at) : new Date(publishAt.getTime() + 24 * HOUR_MS);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new Response(JSON.stringify({ error: "Некорректная дата истечения" }), { status: 400 });
  }
  return {
    kind,
    image_url: kind === "image" ? mediaUrl.trim() : null,
    video_url: kind === "video" ? mediaUrl.trim() : null,
    cover_url: body.cover_url?.trim() || null,
    thumbnail_url: body.thumbnail_url?.trim() || null,
    video_provider: null,
    caption: body.caption?.trim() ? { text: body.caption.trim() } : {},
    publish_at: publishAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    is_evergreen: body.is_evergreen ?? false,
    is_published: body.is_published ?? false,
    order_hint: body.order_hint ?? 0,
  };
}
