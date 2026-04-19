/**
 * Адаптер каналов Bus → snapshot-подобный объект (для совместимости с UI кодом, который
 * ещё не переписан на индивидуальные подписки).
 *
 * Цель — дать экранам единый агрегированный объект, чтобы они могли заменить
 * `onFingerSnapshot(snapshot)` на `useBiofeedbackSnapshot()` без больших правок.
 *
 * Это **временный** слой. После завершения миграции (фазы 7-9) UI должен подписываться
 * на каналы напрямую, и адаптер можно будет удалить.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import { useBiofeedbackBus } from "@/modules/biofeedback/bus/react";
import { useBiofeedbackPipeline } from "@/modules/biofeedback/bus/biofeedback-provider";
import type { ContactState } from "@/modules/biofeedback/quality/contact-monitor";
import type { CalibrationPhase } from "@/modules/biofeedback/quality/calibration-state-machine";
import type { PulseLockState } from "@/modules/biofeedback/core/types";
import type { RawOpticalSample } from "@/modules/biofeedback/sensors/types";

export interface BiofeedbackSnapshot {
  /** Метка последнего значимого события (по времени сэмпла). */
  timestampMs: number;
  /** Текущий усреднённый BPM. */
  pulseRateBpm: number;
  /** Качество сигнала 0..1. */
  signalQuality: number;
  /** Палец касается камеры? */
  fingerDetected: boolean;
  /** Состояние блокировки пульса. */
  pulseLockState: PulseLockState;
  /** Состояние контакта. */
  contactState: ContactState;
  /** Фаза калибровки. */
  calibrationPhase: CalibrationPhase;
  /** Удары были найдены свежими в последнем кадре? */
  hasFreshBeat: boolean;
  /** Текущий список merged ударов из Pipeline (rolling). */
  mergedBeats: readonly number[];
  /** Последние N оптических сэмплов для визуализации (down-sampled). */
  opticalSamples: readonly RawOpticalSample[];
  /** Текущая когерентность %, если активна сессия. */
  currentCoherencePercent: number | null;
  /** Текущая RMSSD ms, если рассчитана. */
  currentRmssdMs: number | null;
  /** Текущий стресс %, если рассчитан. */
  currentStressPercent: number | null;
}

const OPTICAL_HISTORY_LIMIT = 48;

export function useBiofeedbackSnapshot(): BiofeedbackSnapshot {
  const bus = useBiofeedbackBus();
  const pipeline = useBiofeedbackPipeline();
  /** Без этого `useMemo` ниже не пересчитывается: `bus`/`pipeline` стабильны между кадрами. */
  const [revision, setRevision] = useState(0);
  const opticalRef = useRef<RawOpticalSample[]>([]);

  useEffect(() => {
    const bump = () => setRevision((n) => n + 1);
    const unsubs: Array<() => void> = [];
    unsubs.push(
      bus.subscribe("contact", bump),
      bus.subscribe("session", bump),
      bus.subscribe("pulseBpm", bump),
      bus.subscribe("rmssd", bump),
      bus.subscribe("stress", bump),
      bus.subscribe("coherence", bump),
      bus.subscribe("optical", (sample) => {
        opticalRef.current.push(sample);
        if (opticalRef.current.length > OPTICAL_HISTORY_LIMIT) {
          opticalRef.current = opticalRef.current.slice(-OPTICAL_HISTORY_LIMIT);
        }
        // Не форсим re-render на каждом optical сэмпле — UI его и так часто не показывает.
      }),
    );
    return () => {
      for (const u of unsubs) u();
    };
  }, [bus]);

  return useMemo<BiofeedbackSnapshot>(() => {
    const contact = bus.getLast("contact");
    const session = bus.getLast("session");
    const pulse = bus.getLast("pulseBpm");
    const rmssd = bus.getLast("rmssd");
    const stress = bus.getLast("stress");
    const coh = bus.getLast("coherence");

    return {
      timestampMs: opticalRef.current[opticalRef.current.length - 1]?.timestampMs ?? 0,
      pulseRateBpm: pulse?.bpm ?? 0,
      signalQuality:
        contact?.signalQuality != null
          ? Math.min(1, Math.max(0, contact.signalQuality))
          : 0,
      fingerDetected: contact?.state === "present",
      pulseLockState: pulse?.lockState ?? "searching",
      contactState: contact?.state ?? "absent",
      calibrationPhase: session?.phase ?? "idle",
      hasFreshBeat: pulse?.hasFreshBeat ?? false,
      mergedBeats: pipeline.getMergedBeats(),
      opticalSamples: opticalRef.current,
      currentCoherencePercent: coh?.currentPercent ?? null,
      currentRmssdMs: rmssd?.rmssdMs ?? null,
      currentStressPercent: stress?.percent ?? null,
    };
  }, [bus, pipeline, revision]);
}
