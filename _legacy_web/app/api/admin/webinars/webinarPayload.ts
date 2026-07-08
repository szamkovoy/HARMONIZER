export type AdminWebinarPayload = {
  title?: string;
  description?: string;
  starts_at?: string;
  join_url?: string | null;
  recording_url?: string | null;
  is_published?: boolean;
};

function badRequest(message: string): never {
  throw new Response(JSON.stringify({ error: message }), { status: 400 });
}

function parseStartsAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) badRequest("Некорректные дата и время вебинара");
  return date.toISOString();
}

/** Нормализация формы «создать вебинар»: заголовок и дата обязательны. */
export function webinarRowFromPayload(payload: AdminWebinarPayload) {
  const title = payload.title?.trim() ?? "";
  if (!title) badRequest("Название вебинара обязательно");
  if (!payload.starts_at) badRequest("Дата и время вебинара обязательны");
  return {
    title,
    description: payload.description ?? "",
    starts_at: parseStartsAt(payload.starts_at),
    join_url: payload.join_url?.trim() || null,
    recording_url: payload.recording_url?.trim() || null,
    is_published: payload.is_published ?? false,
  };
}

export function webinarUpdateFromPayload(payload: AdminWebinarPayload) {
  const update: Record<string, unknown> = {};
  if (payload.title !== undefined) {
    const title = payload.title.trim();
    if (!title) badRequest("Название вебинара обязательно");
    update.title = title;
  }
  if (payload.description !== undefined) update.description = payload.description;
  if (payload.starts_at !== undefined) update.starts_at = parseStartsAt(payload.starts_at);
  if (payload.join_url !== undefined) update.join_url = payload.join_url?.trim() || null;
  if (payload.recording_url !== undefined) update.recording_url = payload.recording_url?.trim() || null;
  if (payload.is_published !== undefined) update.is_published = payload.is_published;
  if (Object.keys(update).length === 0) badRequest("Нет полей для обновления");
  return update;
}
