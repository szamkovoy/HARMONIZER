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
/**
 * Минимальный интервал между двумя `setRevision`. Bus-каналы `pulseBpm`/`contact`/
 * `coherence` могут эмитить события 5-10 раз в секунду, и каждое из них раньше
 * вызывало полный re-render `CoherenceBreathScreen` (а значит и `BreathBinduMandala`,
 * `BreathIndicatorView` и остального). На длинных практиках (20-40 мин) это
 * приводило к видимому замедлению мандалы и «скачкам» индикатора. Троттлим до 4 Hz
 * — этого достаточно для текстовых индикаторов пульса/качества, а анимации идут
 * через shared values Reanimated и не зависят от re-render'ов React.
 */
const SNAPSHOT_BUMP_MIN_INTERVAL_MS = 250;

export function useBiofeedbackSnapshot(): BiofeedbackSnapshot {
  const bus = useBiofeedbackBus();
  const pipeline = useBiofeedbackPipeline();
  /** Без этого `useMemo` ниже не пересчитывается: `bus`/`pipeline` стабильны между кадрами. */
  const [revision, setRevision] = useState(0);
  const opticalRef = useRef<RawOpticalSample[]>([]);
  const lastBumpWallMsRef = useRef(0);
  const pendingBumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    /**
     * Троттлёный «форс re-render». Если между событиями прошло меньше
     * `SNAPSHOT_BUMP_MIN_INTERVAL_MS` — планируем один отложенный bump и игнорируем
     * промежуточные события. Когда таймер срабатывает, делаем ОДИН `setRevision` —
     * React возьмёт самое свежее состояние каналов через `bus.getLast(...)`.
     */
    const bump = () => {
      const now = Date.now();
      const sinceLast = now - lastBumpWallMsRef.current;
      if (sinceLast >= SNAPSHOT_BUMP_MIN_INTERVAL_MS) {
        if (pendingBumpTimerRef.current != null) {
          clearTimeout(pendingBumpTimerRef.current);
          pendingBumpTimerRef.current = null;
        }
        lastBumpWallMsRef.current = now;
        setRevision((n) => n + 1);
        return;
      }
      if (pendingBumpTimerRef.current != null) return;
      pendingBumpTimerRef.current = setTimeout(() => {
        pendingBumpTimerRef.current = null;
        lastBumpWallMsRef.current = Date.now();
        setRevision((n) => n + 1);
      }, SNAPSHOT_BUMP_MIN_INTERVAL_MS - sinceLast);
    };
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
      if (pendingBumpTimerRef.current != null) {
        clearTimeout(pendingBumpTimerRef.current);
        pendingBumpTimerRef.current = null;
      }
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
