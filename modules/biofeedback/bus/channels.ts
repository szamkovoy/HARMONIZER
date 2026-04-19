/**
 * Каналы BiofeedbackBus: единый каталог имён + типов событий.
 *
 * Каждый канал имеет:
 *  - имя (строковый литерал — для подписки и фильтрации в логах);
 *  - тип события (payload), публикуемый в канал;
 *  - семантику частоты (см. план рефакторинга).
 *
 * Потребители (Breath, Mandala, Probe) импортируют отсюда типы для подписок.
 */

import type {
  BeatChannelEvent,
  CoherenceChannelEvent,
  ContactChannelEvent,
  PulseBpmChannelEvent,
  PulseSourceChannelEvent,
  RmssdChannelEvent,
  RsaChannelEvent,
  SessionChannelEvent,
  StressChannelEvent,
} from "@/modules/biofeedback/engines/types";
import type { RawOpticalSample } from "@/modules/biofeedback/sensors/types";

/** Полный каталог каналов и типов событий. */
export interface ChannelMap {
  /** Срабатывает на каждый удар (реальный или экстраполированный). */
  beat: BeatChannelEvent;
  /** Срабатывает на каждый кадр пульса (~ FPS), но дросселируется на стороне Bus до ~2 Hz. */
  pulseBpm: PulseBpmChannelEvent;
  /** Текущая RMSSD (новое значение или подтверждение). */
  rmssd: RmssdChannelEvent;
  /** Текущий стресс. */
  stress: StressChannelEvent;
  /** Текущая когерентность (по секунде практики). */
  coherence: CoherenceChannelEvent;
  /** Завершённый дыхательный цикл RSA. */
  rsa: RsaChannelEvent;
  /** Изменение контакта пальца. */
  contact: ContactChannelEvent;
  /** Переход фазы калибровки. */
  session: SessionChannelEvent;
  /** Сырые оптические сэмплы (для отладочного инспектора и экспорта v3). */
  optical: RawOpticalSample;
  /** Источник ударов: реальный датчик vs эмулятор. Потребители → withhold метрик при эмуляции. */
  pulseSource: PulseSourceChannelEvent;
  /** Ошибки сенсоров/engines (для UI-баннеров). */
  error: { source: string; message: string };
}

export type ChannelName = keyof ChannelMap;
export type ChannelEvent<K extends ChannelName> = ChannelMap[K];
export type ChannelListener<K extends ChannelName> = (event: ChannelEvent<K>) => void;
