/** Запрос на главном экране: при следующем фокусе выполнить refresh с оверлеем загрузки. */
type Pending = { forceRefresh: boolean };

let pending: Pending | null = null;

export function markHomeDayContentBlockingReload(opts?: { forceRefresh?: boolean }): void {
  pending = { forceRefresh: Boolean(opts?.forceRefresh) };
}

export function consumeHomeDayContentBlockingReload(): Pending | null {
  const next = pending;
  pending = null;
  return next;
}
