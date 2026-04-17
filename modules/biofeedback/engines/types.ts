/**
 * Engines layer: каждая физическая величина (пульс, RMSSD, стресс, когерентность, RSA, live beat)
 * считается ровно одним engine. Engines stateful, чистые от UI.
 *
 * Общие типы для подписчиков и shared snapshot, который engine отдаёт после `push()`.
 */

import type { CalibrationPhase } from "@/modules/biofeedback/quality/calibration-state-machine";
import type { ContactState } from "@/modules/biofeedback/quality/contact-monitor";
import type { BeatEvent } from "@/modules/biofeedback/sensors/types";
import type { PulseLockState, StressReadinessTier } from "@/modules/biofeedback/core/types";

/** Минимум, что должен отдавать любой engine для отладки. */
export interface EngineMeta {
  name: string;
  version: string;
  /** Сколько раз `push()` был вызван (для diagnostics). */
  pushCount: number;
}

/** Все события из engines, которые публикуются на BiofeedbackBus. */

export interface BeatChannelEvent {
  beat: BeatEvent;
}

export interface PulseBpmChannelEvent {
  bpm: number;
  windowSeconds: number;
  lockState: PulseLockState;
  /** Был ли свежий удар на текущем кадре (UI может прятать BPM при stale). */
  hasFreshBeat: boolean;
  /** Сырое значение «доверия» текущему пульсу (0..1) — для отладки/мандалы. */
  confidence: number;
}

export interface RmssdChannelEvent {
  rmssdMs: number;
  /** Сегмент: общий / начало / конец (как в текущих тиерах HRV). */
  segment: "all" | "initial" | "final";
  tier: string;
  validBeatCount: number;
  /** Если выставлен, расчёт основан на коротких сегментах и считается приближённым. */
  approximate: boolean;
}

export interface StressChannelEvent {
  percent: number;
  rawIndex: number;
  segment: "all" | "initial" | "final";
  tier: StressReadinessTier;
  approximate: boolean;
}

export interface CoherenceChannelEvent {
  /** Текущая когерентность (последняя секунда), %. */
  currentPercent: number;
  /** Среднее по сессии за последний секундный шаг, %. */
  averagePercent: number;
  /** Максимум по сессии, %. */
  maxPercent: number;
  /** Сглаженный (3-с медиана) ряд, %. */
  smoothedSeries: readonly number[];
  /** Время вхождения (с) или null. */
  entryTimeSec: number | null;
}

export interface RsaChannelEvent {
  /** Амплитуда RSA по последнему завершённому циклу или медиана активных. */
  amplitudeBpm: number;
  /** Нормированная амплитуда (RSA / mean BPM × 100), %, или null. */
  normalizedPercent: number | null;
  activeCycleCount: number;
}

export interface ContactChannelEvent {
  state: ContactState;
  confidence: number;
  absentForMs: number;
}

export interface SessionChannelEvent {
  phase: CalibrationPhase;
  warmupElapsedMs: number;
  settleGoodMsAccum: number;
  /** Стало ready именно сейчас (одноразовый флаг). */
  becameReady: boolean;
  /** Стало lost именно сейчас. */
  becameLost: boolean;
}
