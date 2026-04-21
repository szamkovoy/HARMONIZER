/**
 * BiofeedbackBus: тонкая типизированная pub/sub-шина для биометрических событий.
 *
 * - Подписки добавляются `subscribe(channel, listener)` → возвращается unsubscribe.
 * - Публикация `publish(channel, event)` синхронно вызывает всех подписчиков.
 * - Кольцевой буфер последних N событий на канал (для отладки + старт подписчиков
 *   с актуальным значением через `getLast(channel)`).
 *
 * Реализация без зависимостей: ничего не знает про React и про DOM. React-обвязка
 * (`BiofeedbackBusProvider`, `useBiofeedbackChannel`) — отдельный файл `react.tsx`.
 */

import type {
  ChannelEvent,
  ChannelListener,
  ChannelName,
} from "@/modules/biofeedback/bus/channels";

const RING_SIZE_DEFAULT = 256;

/**
 * Каналы с «высокой» частотой публикаций (≥10 Гц): optical 30 Гц, contact 30 Гц.
 * Для них храним **существенно меньше** истории — иначе на длинных практиках
 * накапливается GC-давление (каждая публикация делает `history.push + history.shift`
 * при переполнении, а full-скан массива в 256 элементов на каждом из 36 000 кадров
 * за 20 минут сессии ощутимо греет CPU). Экспорт v3 всё равно ограничивает
 * channel log `slice(-256)`, и 64 точки оптики/контакта за последнюю секунду
 * достаточно для диагностики.
 */
const HOT_CHANNELS: ReadonlySet<string> = new Set<string>(["optical", "contact"]);
const HOT_CHANNEL_HISTORY_LIMIT = 32;

export class BiofeedbackBus {
  private readonly listeners: Map<ChannelName, Set<ChannelListener<ChannelName>>> = new Map();
  private readonly lastEvent: Map<ChannelName, unknown> = new Map();
  private readonly history: Map<ChannelName, unknown[]> = new Map();
  private readonly historyLimit: number;

  constructor(options: { historyLimit?: number } = {}) {
    this.historyLimit = options.historyLimit ?? RING_SIZE_DEFAULT;
  }

  private limitForChannel(channel: ChannelName): number {
    if (HOT_CHANNELS.has(String(channel))) {
      return Math.min(HOT_CHANNEL_HISTORY_LIMIT, this.historyLimit);
    }
    return this.historyLimit;
  }

  subscribe<K extends ChannelName>(channel: K, listener: ChannelListener<K>): () => void {
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
    }
    set.add(listener as ChannelListener<ChannelName>);
    return () => {
      const s = this.listeners.get(channel);
      if (s) {
        s.delete(listener as ChannelListener<ChannelName>);
      }
    };
  }

  publish<K extends ChannelName>(channel: K, event: ChannelEvent<K>): void {
    this.lastEvent.set(channel, event);
    const limit = this.limitForChannel(channel);
    const ring = this.history.get(channel) ?? [];
    ring.push(event);
    // Для hot-каналов дополнительно схлопываем возможно переросшую историю в
    // один `splice`, а не многократные `shift` — важно при переходе с большого
    // лимита (для холодных каналов) обратно на маленький.
    if (ring.length > limit) {
      ring.splice(0, ring.length - limit);
    }
    this.history.set(channel, ring);

    const set = this.listeners.get(channel);
    if (!set || set.size === 0) {
      return;
    }
    // Снимаем копию, чтобы безопасно отписываться внутри listener'а.
    const snapshot = Array.from(set) as Array<ChannelListener<K>>;
    for (const l of snapshot) {
      try {
        l(event);
      } catch (err) {
        // Не валим всю шину из-за одного подписчика — публикуем в `error`.
        if (channel !== ("error" as ChannelName)) {
          this.publish("error", {
            source: `BiofeedbackBus.listener[${String(channel)}]`,
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  getLast<K extends ChannelName>(channel: K): ChannelEvent<K> | undefined {
    return this.lastEvent.get(channel) as ChannelEvent<K> | undefined;
  }

  /** Снимок последних N событий канала (для экспорта v3 / debug-панели). */
  getHistory<K extends ChannelName>(channel: K): readonly ChannelEvent<K>[] {
    return (this.history.get(channel) ?? []) as ChannelEvent<K>[];
  }

  /** Полностью очищает шину (между сессиями). */
  reset(): void {
    this.listeners.clear();
    this.lastEvent.clear();
    this.history.clear();
  }

  /** Очищает только историю и last-снимки, сохраняя подписчиков. */
  clearHistory(): void {
    this.lastEvent.clear();
    this.history.clear();
  }
}
