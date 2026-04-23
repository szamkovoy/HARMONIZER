/**
 * «Приветственное сообщение по умолчанию» для коммуникатора.
 *
 * Назначение: другие модули (BREATH / будущий Assistant) хотят открыть
 * коммуникатор с заранее заданным первым сообщением от пользователя и
 * сразу получить от ИИ ответ — например, «Обсудить результаты практики».
 *
 * Чтобы не тащить через URL огромный JSON-пайлоад, используем синглтон-
 * очередь (одна «ожидающая» запись за раз). Breath кладёт payload сюда,
 * затем навигирует на экран коммуникатора, и при монтировании
 * `<Communicator />` проверяет очередь и, если нашёл запись, автоматически
 * отправляет её как первое сообщение пользователя.
 *
 * Почему не prop через history: history лишь seed-ит локальный стейт, но
 * НЕ вызывает ИИ — ответа не будет. Нам нужен именно «автоматический
 * send», поэтому работаем через ref + эффект на mount, см.
 * `Communicator.tsx` / `autoSendInitialMessage`.
 */

export interface PendingCommunicatorGreeting {
  /**
   * Текст, который будет отправлен от имени пользователя. Видим в чате
   * как обычное сообщение пользователя — ИИ на него отвечает. Рекомендуется
   * короткая преамбула + сериализованные данные (JSON блоком `\u0060\u0060\u0060json ... \u0060\u0060\u0060`).
   */
  userText: string;
  /**
   * Необязательная корректировка системного промпта для этой сессии.
   * Если задана, переопределяет дефолтный `systemPrompt` прямо на экране
   * коммуникатора (только для этого первого сообщения и следующих за ним
   * — до перезапуска/перезахода).
   */
  systemPrompt?: string;
  /** Метка, какой модуль сформировал greeting (для дебага/логов). */
  source: string;
  /** Когда добавлено (Date.now()). Для sanity-check и истечения, если нужно. */
  enqueuedAtMs: number;
}

let pending: PendingCommunicatorGreeting | null = null;
const listeners = new Set<() => void>();

/**
 * Поставить приветственное сообщение в очередь. Перезаписывает предыдущее,
 * если оно ещё не было забрано коммуникатором.
 */
export function enqueueCommunicatorGreeting(
  greeting: Omit<PendingCommunicatorGreeting, "enqueuedAtMs">,
): void {
  pending = { ...greeting, enqueuedAtMs: Date.now() };
  for (const l of listeners) l();
}

/**
 * Снять и вернуть текущее ожидающее сообщение (без повторных доставок).
 * Коммуникатор вызывает это один раз при монтировании.
 */
export function consumeCommunicatorGreeting(): PendingCommunicatorGreeting | null {
  const r = pending;
  pending = null;
  if (r) {
    for (const l of listeners) l();
  }
  return r;
}

/** Есть ли сейчас что-то в очереди (не удаляя). */
export function peekCommunicatorGreeting(): PendingCommunicatorGreeting | null {
  return pending;
}

/**
 * Подписка на изменения очереди. Возвращает unsubscribe.
 * В коммуникаторе подписываться не требуется (берёт на mount через consume),
 * но оставляем на случай использования из «точки входа» (tab layout).
 */
export function subscribePendingGreeting(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
