/**
 * Sensor layer: единый интерфейс для любых источников биометрии.
 *
 * Источники бывают двух типов:
 *  1) Оптические (PPG): отдают `RawOpticalSample` — анализатор сам найдёт удары.
 *  2) Готовые beat-источники (BLE HR, Apple Watch, будущий Edge-AI детектор): отдают `BeatEvent`.
 *
 * Общий контракт: каждый Sensor имеет канал `meta` (контакт/качество/готовность) и
 * управляющие методы start/stop. Конкретные потоки (`opticalStream`, `beatStream`) опциональны.
 */

import type { BiofeedbackCaptureConfig } from "@/modules/biofeedback/core/types";

/** Тип источника биометрии. Расширяется по мере подключения новых сенсоров. */
export type BiofeedbackSourceKind =
  | "fingerCamera"
  | "faceCamera"
  | "simulated"
  | "health"
  | "wearable";

/** Сырой оптический сэмпл (один кадр PPG-подобного источника). */
export interface RawOpticalSample {
  timestampMs: number;
  width: number;
  height: number;
  redMean: number;
  greenMean: number;
  blueMean: number;
  lumaMean: number;
  /** Доминирование красного (R / max(R, G, B) с поправкой). */
  redDominance: number;
  /** Доля «тёмных» пикселей в ROI. */
  darknessRatio: number;
  /** Доля «насыщенных» пикселей в ROI. */
  saturationRatio: number;
  /** Оценка глобального движения между кадрами. */
  motion: number;
  /** Сколько пикселей реально вошло в ROI. */
  sampleCount: number;
  /** Площадь ROI в долях кадра. */
  roiAreaRatio: number;
}

/** Готовое событие удара сердца (источники с уже распознанными R-пиками: ECG, BLE HR, watch). */
export interface BeatEvent {
  /** Время удара (та же шкала, что и `RawOpticalSample.timestampMs` сенсора). */
  timestampMs: number;
  /** Источник: `detected` — реально распознан; `extrapolated` — выдан LivePulseChannel в holding. */
  source: "detected" | "extrapolated";
  /** Опционально: уверенность детектора (0–1). */
  confidence?: number;
}

/** Метаданные сенсора (контакт, готовность). Публикуются в канал `meta`. */
export interface SensorMeta {
  /** Источник этих метаданных. */
  source: BiofeedbackSourceKind;
  /** Сколько кадров/сэмплов получено за всё время сессии. */
  sampleCount: number;
  /** Текущий FPS (для optical-источников). */
  fps: number;
  /** Готов ли сенсор к работе (для камер: камера инициализирована, разрешение получено). */
  ready: boolean;
}

/** Подписки на потоки сенсора. Любые из них могут быть `undefined`. */
export interface SensorListeners {
  onOpticalSample?: (sample: RawOpticalSample) => void;
  onBeatEvent?: (beat: BeatEvent) => void;
  onMeta?: (meta: SensorMeta) => void;
  onError?: (err: unknown) => void;
}

/** Хэндл активного сенсора. */
export interface SensorHandle {
  stop(): Promise<void> | void;
}

/** Базовый интерфейс сенсора. */
export interface BiofeedbackSensor {
  readonly source: BiofeedbackSourceKind;
  /** Источник отдаёт оптические сэмплы (PPG-подобный)? */
  readonly producesOptical: boolean;
  /** Источник отдаёт готовые beat-события (watch / BLE / Edge-AI)? */
  readonly producesBeats: boolean;
  start(config: BiofeedbackCaptureConfig, listeners: SensorListeners): Promise<SensorHandle>;
}
