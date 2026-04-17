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

export class BiofeedbackBus {
  private readonly listeners: Map<ChannelName, Set<ChannelListener<ChannelName>>> = new Map();
  private readonly lastEvent: Map<ChannelName, unknown> = new Map();
  private readonly history: Map<ChannelName, unknown[]> = new Map();
  private readonly historyLimit: number;

  constructor(options: { historyLimit?: number } = {}) {
    this.historyLimit = options.historyLimit ?? RING_SIZE_DEFAULT;
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
    const ring = this.history.get(channel) ?? [];
    ring.push(event);
    if (ring.length > this.historyLimit) {
      ring.shift();
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
