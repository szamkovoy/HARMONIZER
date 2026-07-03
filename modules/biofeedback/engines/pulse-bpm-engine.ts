/**
 * PulseBpmEngine: текущий BPM по скользящему окну 10 с.
 *
 * Два режима:
 *  - **wearable / simulated / emulated** — «доверенный» ряд RR: жёсткий фильтр + окно 10 с +
 *    медианный BPM, без гейтов и интерполяции (chest strap точнее камеры, ему не нужен сдвиг).
 *  - **fingerCamera** — оптический PPG. Здесь пульс нужен только чтобы вести дыхание, поэтому
 *    допускается небольшая «задержка решения» (look-ahead): движок реконструирует окно ударов,
 *    интерполируя короткие пропадания сигнала.
 *
 * ## Оптическая модель (fingerCamera)
 *
 * PPG с камеры регулярно теряет отдельные удары: палец чуть сместился, экспозиция «плывёт» при
 * возврате пальца, fps проседает до 5–8. Раньше такие пропадания давали два артефакта:
 *  1) **краевые пики** — интервал через пропадание («straddle» pre-gap→post-gap удар) или первый
 *     пост-гэп RR (звон zero-phase bandpass на разрыве) попадал в медиану и давал ложный скачок
 *     BPM вверх/вниз ровно на границе серой полосы;
 *  2) **исчезновение пульса** — во время короткого провала окно RR пустело, BPM «замерзал»/обнулялся,
 *     дыхание получало устаревший или нулевой темп.
 *
 * Теперь для fingerCamera строится **реконструированное окно**:
 *  - разрыв между принятыми ударами > `gapThresh` (≈1.6 RR) трактуется как пропущенные удары;
 *  - если разрыв «интерполируемый» (≤ `OPTICAL_INTERP_MAX_MS`), он заполняется синтетическими
 *    ударами на последнем стабильном RR (равные суб-интервалы) — straddle-RR исчезает, окно
 *    остаётся плотным, BPM плавный (`bridgingShortGap = true`, не `reacquiring`);
 *  - тот же принцип для **открытого** разрыва в конце (палец только вернулся, детектор ещё голодает):
 *    пока провал ≲ bridge-окна, держим стабильный BPM синтетическими ударами; это и есть «сдвиг окна»
 *    из ТЗ — мы ждём, интерполируется сигнал или уходит в синтетику;
 *  - если разрыв длиннее интерполируемого (реальная длинная потеря), заполнения нет: `reacquiring = true`,
 *    прошлый BPM удерживается, а после возврата сигнала ждём `POST_GAP_MIN_RR` чистых RR прежде чем
 *    снова доверять BPM (первые пост-гэп RR всё ещё артефактны).
 *
 * Важно: реконструкция влияет только на **guidance-BPM** (окно, медиана, отображение). Наружу отдаётся
 * `filteredBeatTimestampsMs` из РЕАЛЬНЫХ ударов — синтетические удары в HRV/coherence/canonical не попадают
 * (для оптики эти метрики и так не считаются, но контракт сохраняем).
 */

import {
  BEAT_DUPLICATE_TOLERANCE_MS,
  PULSE_RR_DEVIATION_RATIO,
  PULSE_RR_MAX_MS,
  PULSE_RR_MIN_MS,
  PULSE_WINDOW_MS,
  PULSE_WINDOW_TRUSTED_MS,
  RR_SEQUENCE_MIN_ALLOWED_DELTA_MS,
  RR_SEQUENCE_MIN_CONTEXT,
  RR_SEQUENCE_WINDOW_SIZE,
} from "@/modules/biofeedback/constants";
import {
  calculatePulseRateBpm,
  calculatePulseRateBpmMedian,
} from "@/modules/biofeedback/core/metrics";
import { median } from "@/modules/biofeedback/signal/optical-pipeline";

export interface PulseBpmInput {
  timestampMs: number;
  /** Полный отсортированный merged-ряд ударов. */
  mergedBeats: readonly number[];
  sourceKind?: "fingerCamera" | "wearable" | "simulated" | "emulated" | "none";
  /**
   * Pipeline-level coherent baseline RR (`lastStableRrMs`, обновляется только на
   * `looksCoherent` окне и переживает finger-off hard-reset). Передаётся в engine
   * как fallback для `stableRr` в `pushOptical`: если собственный
   * `lastStableMedianRrMs` engine-а и `realMedianRr` оба 0 (RR-фильтр переотбраковал
   * маргинальный ряд, или coherent-окно ещё не набралось в engine), bridge коротких
   * gap-ов всё равно достроит синтетику на этом baseline — иначе короткая потеря
   * сигнала рисует серую полосу, хотя когерентный ритм известен.
   */
  pipelineStableRrMs?: number;
  /**
   * Source-timestamp of the last sample that produced a coherent window
   * (pipeline `lastStableBeatTs`). Используется reconstruct-функцией как
   * anchor для синтетического bridge-а, когда RR-фильтр переотбраковал весь
   * маргинальный ряд и `acceptedBeats` пуст — без anchor bridge коротких
   * gap-ов молчит и рисует серую полосу.
   */
  lastTrustedBeatTs?: number;
}

export interface PulseBpmSnapshot {
  /** Текущий средний BPM. 0 если данных мало. */
  bpm: number;
  /** Мгновенный BPM без display-сглаживания. */
  rawBpm: number;
  /** Размер использованного окна (с). */
  windowSeconds: number;
  /** Число RR в окне. */
  rrCount: number;
  /** Медианный RR (мс) — для оценки джиттера. */
  medianRrMs: number;
  /** Джиттер: медиана |RR - medianRR|. */
  jitterMs: number;
  /** Все интервалы окна (для UI / экспорта). */
  intervalsMs: number[];
  /** Соответствует ли окно условию «когерентный пульс» (≥5 RR + jitter в норме). */
  looksCoherent: boolean;
  /** Время последнего использованного удара. */
  lastBeatTimestampMs: number;
  /** Канонический поток ударов после pulse RR filter. */
  filteredBeatTimestampsMs: number[];
  /**
   * True (только для finger PPG) при длинной потере сигнала: пре-гэп удары исключены из окна,
   * BPM удерживается на прошлом значении и не считается «живым», пока не накопится
   * `POST_GAP_MIN_RR` чистых пост-гэп RR. Wearable RR точны и не гейтятся.
   */
  reacquiring: boolean;
  /**
   * True (только finger PPG) — короткое пропадание сигнала интерполируется/бриджуется: BPM
   * держится на стабильном ритме синтетическими ударами, кадр всё ещё считается живым.
   */
  bridgingShortGap: boolean;
}

/**
 * Сколько чистых пост-гэп RR нужно накопить после ДЛИННОЙ (не интерполируемой) потери, прежде
 * чем снова доверять BPM. Первые 1-2 пост-гэп RR часто артефактны (звон bandpass на разрыве
 * `dropSamplesSince`, пиковый детектор ловит первый пик чуть раньше истинного систолического),
 * поэтому одиночный короткий RR не должен задавать медиану. Для КОРОТКИХ (интерполируемых)
 * провалов этот порог не применяется: интерполяция сама убирает краевой артефакт.
 */
const POST_GAP_MIN_RR = 5;

/** Разрыв между принятыми ударами трактуется как «пропущенные удары», если он больше этого. */
export const OPTICAL_GAP_MISSED_BEATS = 1.6;
export const OPTICAL_GAP_MIN_MS = 1_500;

/**
 * Максимально интерполируемый разрыв — ФИКСИРОВАННЫЙ бюджет времени, а не число ударов.
 * Он должен покрывать короткое снятие пальца (пользователь в тесте убирал палец на ~3 с)
 * ПЛЮС латентность повторного захвата оптики после возврата пальца. На маргинальном PPG
 * (холодный палец / слабая перфузия) relock может занимать до ~9–12 с даже с relax-sweep
 * (peak-detector 1.2.18) и чистым flush буфера — поэтому бюджет 12 с, чтобы 3-с lift
 * оставался bridged в типовых и большинстве пограничных случаев. Реальная длинная потеря
 * (снятие на 20 с) заведомо длиннее и уходит в reacquire → emulated. Для guidance-only
 * оптики удержание ритма на последнем стабильном RR до ~12 с приемлемо: пульс покоя не
 * «телепортируется», а медицинская точность здесь не нужна (метрики по камере не считаются).
 *
 * Бюджет намеренно НЕ масштабируется по stableRr: длительность закрытого разрыва константна,
 * а stableRr после разрыва дрейфует вместе с пульсом — масштабированный порог заставлял бы
 * один и тот же разрыв флипаться между «интерполируемым» и «жёстким» от кадра к кадру.
 */
const OPTICAL_INTERP_MAX_MS = 12_000;

/** Открытый разрыв в конце (палец вернулся, детектор ещё догоняет) бриджуем тем же бюджетом. */
export const OPTICAL_OPEN_BRIDGE_MAX_MS = 12_000;

function opticalGapThresholdMs(stableRrMs: number): number {
  if (!(stableRrMs > 0) || !Number.isFinite(stableRrMs)) return OPTICAL_GAP_MIN_MS;
  return Math.max(OPTICAL_GAP_MIN_MS, stableRrMs * OPTICAL_GAP_MISSED_BEATS);
}

interface RrMeasurement {
  intervalMs: number;
  startTimestampMs: number;
  endTimestampMs: number;
}

export function buildRrMeasurements(beats: readonly number[]): RrMeasurement[] {
  const out: RrMeasurement[] = [];
  for (let i = 1; i < beats.length; i += 1) {
    const start = beats[i - 1]!;
    const end = beats[i]!;
    const interval = end - start;
    if (interval > 0) {
      out.push({ intervalMs: interval, startTimestampMs: start, endTimestampMs: end });
    }
  }
  return out;
}

/**
 * Дублирует логику `filterSequentialRrMeasurements` из старого finger-analysis.ts:
 * жёсткий диапазон + последовательный фильтр (после `RR_SEQUENCE_MIN_CONTEXT` принятых,
 * каждый следующий проверяется по медиане окна `RR_SEQUENCE_WINDOW_SIZE`).
 *
 * Важно: контекст последовательного фильтра СБРАСЫВАЕТСЯ через длинный разрыв. Ритм за время
 * потери сигнала мог физиологично сдвинуться (например, +15–20 bpm за 5–10 с), и сравнение
 * пост-гэп RR с ПРЕ-гэп медианой раньше давало дедлок: каждый новый RR отклонялся от старой
 * медианы, отклонённые RR не обновляли контекст, и весь пост-гэп сигнал отбрасывался, пока
 * пре-гэп история не устареет из 2-мин окна. После сброса пост-гэп RR валидируются друг
 * относительно друга; недоверие к первым пост-гэп ударам обеспечивает reacquire-гейт движка.
 */
export function filterPulseRrMeasurements(
  measurements: readonly RrMeasurement[],
  sourceKind: PulseBpmInput["sourceKind"] = "fingerCamera",
): RrMeasurement[] {
  const accepted: RrMeasurement[] = [];
  const hardMin = sourceKind === "wearable" ? 300 : PULSE_RR_MIN_MS;
  const hardMax = sourceKind === "wearable" ? 2000 : PULSE_RR_MAX_MS;
  const deviationRatio = sourceKind === "wearable" ? 0.22 : PULSE_RR_DEVIATION_RATIO;
  // Разрыв длиннее максимально валидного RR × 2 означает потерю сигнала → новый контекст.
  const contextResetGapMs = hardMax * 2;
  let contextStart = 0;
  for (const m of measurements) {
    const lastAccepted = accepted[accepted.length - 1];
    if (lastAccepted && m.startTimestampMs - lastAccepted.endTimestampMs > contextResetGapMs) {
      contextStart = accepted.length;
    }
    if (m.intervalMs < hardMin || m.intervalMs > hardMax) {
      continue;
    }
    const contextLength = accepted.length - contextStart;
    if (contextLength >= RR_SEQUENCE_MIN_CONTEXT) {
      const recent = accepted
        .slice(Math.max(contextStart, accepted.length - RR_SEQUENCE_WINDOW_SIZE))
        .map((x) => x.intervalMs);
      const med = median(recent);
      const allowed = Math.max(
        RR_SEQUENCE_MIN_ALLOWED_DELTA_MS,
        med * deviationRatio,
      );
      if (Math.abs(m.intervalMs - med) > allowed) {
        continue;
      }
    }
    accepted.push(m);
  }
  return accepted;
}

function selectRecentRrMeasurements(
  measurements: readonly RrMeasurement[],
  nowMs: number,
  windowMs: number,
): RrMeasurement[] {
  const cutoff = nowMs - windowMs;
  const out: RrMeasurement[] = [];
  for (const m of measurements) {
    if (m.endTimestampMs > cutoff) {
      out.push(m);
    }
  }
  return out;
}

export function buildFilteredBeatTimestamps(
  measurements: readonly RrMeasurement[],
): number[] {
  if (measurements.length === 0) return [];
  const beats: number[] = [];
  for (const measurement of measurements) {
    if (beats.length === 0) {
      beats.push(measurement.startTimestampMs, measurement.endTimestampMs);
      continue;
    }
    const lastBeat = beats[beats.length - 1]!;
    if (Math.abs(measurement.startTimestampMs - lastBeat) <= BEAT_DUPLICATE_TOLERANCE_MS) {
      if (measurement.endTimestampMs - lastBeat > BEAT_DUPLICATE_TOLERANCE_MS * 0.35) {
        beats.push(measurement.endTimestampMs);
      }
      continue;
    }
    beats.push(measurement.startTimestampMs, measurement.endTimestampMs);
  }
  return beats;
}

export interface OpticalReconResult {
  /** Реконструированные удары (реальные + интерполированные) в пределах окна. */
  beats: number[];
  /** Идёт интерполяция/бридж короткого пропадания у хвоста окна. */
  bridging: boolean;
  /** Длинная потеря: держим прошлый BPM, ждём чистые пост-гэп RR. */
  reacquiring: boolean;
}

/**
 * Реконструирует окно ударов оптического PPG: заполняет короткие пропадания синтетическими
 * ударами на `stableRrMs`, помечает длинные пропадания как reacquire. Чистая функция —
 * тестируется отдельно от движка.
 *
 * `acceptedBeats` — отсортированные РЕАЛЬНЫЕ удары после pulse RR filter.
 */
export function reconstructOpticalBeatWindow(
  acceptedBeats: readonly number[],
  nowMs: number,
  stableRrMs: number,
  windowMs: number,
  lastTrustedBeatTs = 0,
): OpticalReconResult {
  const recon: number[] = [];
  let bridging = false;
  let reacquiring = false;
  let lastHardGapResumeTs = -1;

  const gapThresh = opticalGapThresholdMs(stableRrMs);
  const maxInterp = OPTICAL_INTERP_MAX_MS;
  const windowStart = nowMs - windowMs;

  for (let i = 0; i < acceptedBeats.length; i += 1) {
    const beat = acceptedBeats[i]!;
    if (i > 0) {
      const prev = acceptedBeats[i - 1]!;
      const gap = beat - prev;
      if (gap > gapThresh && stableRrMs > 0) {
        if (gap <= maxInterp) {
          // Интерполируемое пропадание: равные суб-интервалы ≈ stableRr. Это убирает
          // straddle-RR и первый артефактный пост-гэп RR (краевые пики).
          const n = Math.max(2, Math.round(gap / stableRrMs));
          for (let k = 1; k < n; k += 1) {
            recon.push(prev + (gap * k) / n);
          }
          // Бридж считается влияющим на текущий вывод, только если хвост пропадания
          // попадает в отображаемое окно.
          if (beat >= windowStart) bridging = true;
        } else {
          // Длинное (не интерполируемое) закрытое пропадание — сигнал вернулся после
          // реальной потери; straddle-RR оставляем «как есть» (его отбракует hard-фильтр).
          lastHardGapResumeTs = beat;
        }
      }
    }
    recon.push(beat);
  }

  // «Устаканивание» после длинного закрытого пропадания: пока после него не накопилось
  // POST_GAP_MIN_RR чистых РЕАЛЬНЫХ RR, BPM не доверяем. Важно: давно завершённый hard-gap
  // (уже набравший чистые пост-гэп RR) НЕ должен блокировать бридж последующих коротких
  // пропаданий — иначе одна длинная потеря «отравляет» всю оставшуюся историю окна.
  let hardGapSettling = false;
  if (lastHardGapResumeTs >= 0) {
    let postGapRealBeats = 0;
    for (const beat of acceptedBeats) {
      if (beat >= lastHardGapResumeTs) postGapRealBeats += 1;
    }
    hardGapSettling = postGapRealBeats - 1 < POST_GAP_MIN_RR;
  }

  // Открытый разрыв в конце (палец вернулся, но детектор ещё не выдал новый удар,
  // либо палец только что снят): решаем, бриджить или уходить в reacquire.
  let lastBeat = acceptedBeats[acceptedBeats.length - 1];
  // Empty-window rescue: на маргинальном PPG RR-фильтр может переотбраковать ВЕСЬ ряд
  // в окне ( erratic RR не проходит ±16 % deviation-gate), и `acceptedBeats` пуст,
  // хотя когерентный ритм был известен чуть раньше. Без anchor bridge молчит → серая
  // полоса на короткой потере. Если pipeline还记得 последний trusted beat и он в within
  // bridge-бюджета, синтезируем окно на stableRr от этого anchor-а.
  if (lastBeat == null && stableRrMs > 0 && lastTrustedBeatTs > 0) {
    const trustedGap = nowMs - lastTrustedBeatTs;
    if (trustedGap <= OPTICAL_OPEN_BRIDGE_MAX_MS) {
      const n = Math.floor(trustedGap / stableRrMs);
      for (let k = 1; k <= n; k += 1) {
        const beat = lastTrustedBeatTs + stableRrMs * k;
        if (beat > windowStart) recon.push(beat);
      }
      bridging = true;
      // Для BPM-расчёта ниже нужен последний синтетический удар как хвост окна.
      lastBeat = lastTrustedBeatTs;
    }
  }
  if (lastBeat != null && stableRrMs > 0) {
    const openGap = nowMs - lastBeat;
    if (openGap > gapThresh) {
      if (openGap <= OPTICAL_OPEN_BRIDGE_MAX_MS && !hardGapSettling) {
        const n = Math.floor(openGap / stableRrMs);
        for (let k = 1; k <= n; k += 1) {
          recon.push(lastBeat + stableRrMs * k);
        }
        bridging = true;
      } else {
        reacquiring = true;
      }
    }
  }

  if (hardGapSettling) {
    reacquiring = true;
    bridging = false;
  }

  const trimmed = recon.filter((beat) => beat > windowStart);
  return { beats: trimmed, bridging, reacquiring };
}

/**
 * Ограничение скорости изменения guidance-BPM для оптики (bpm/с). Физиологический тренд
 * покоя (включая RSA-волны, уже сглаженные 10-с окном) укладывается с запасом, а дискретные
 * ступени медианы пула кандидатов (смена состава окна на границе интерполяции) — режутся.
 * Wearable-путь не ограничивается: там RR точны и ступеней нет.
 */
const OPTICAL_DISPLAY_MAX_SLEW_BPM_PER_SEC = 6;

export class PulseBpmEngine {
  private displayBpm = 0;
  private lastReliableBpmTs = 0;
  private lastStableMedianRrMs = 0;
  private lastDisplayUpdateTs = 0;
  private recentDisplayCandidates: Array<{ timestampMs: number; bpm: number; reliable: boolean }> = [];

  push(input: PulseBpmInput): PulseBpmSnapshot {
    const { timestampMs, mergedBeats, sourceKind = "fingerCamera", pipelineStableRrMs = 0, lastTrustedBeatTs = 0 } = input;
    const all = buildRrMeasurements(mergedBeats);
    const filtered = filterPulseRrMeasurements(all, sourceKind);
    const filteredBeatTimestampsMs = buildFilteredBeatTimestamps(filtered);
    const lastBeatTimestampMs = mergedBeats[mergedBeats.length - 1] ?? 0;

    if (sourceKind === "fingerCamera") {
      return this.pushOptical(timestampMs, filtered, filteredBeatTimestampsMs, lastBeatTimestampMs, pipelineStableRrMs, lastTrustedBeatTs);
    }
    return this.pushTrusted(timestampMs, filtered, filteredBeatTimestampsMs, lastBeatTimestampMs);
  }

  /** Wearable / simulated / emulated: доверенный ряд RR, без интерполяции и гейтов. */
  private pushTrusted(
    timestampMs: number,
    filtered: readonly RrMeasurement[],
    filteredBeatTimestampsMs: number[],
    lastBeatTimestampMs: number,
  ): PulseBpmSnapshot {
    // Trusted RR точны — короткое окно (PULSE_WINDOW_TRUSTED_MS), чтобы медиана не сглаживала
    // реальный пик HR при нагрузке. 10-с окно превращало пик ~135 bpm в плоское плато 131.
    const window = selectRecentRrMeasurements(filtered, timestampMs, PULSE_WINDOW_TRUSTED_MS);
    const intervals = window.map((m) => m.intervalMs);
    const medianRr = median(intervals);
    const jitter = median(intervals.map((v) => Math.abs(v - medianRr)));
    const looksCoherent =
      intervals.length >= 5 && medianRr > 0 && jitter <= Math.max(110, medianRr * 0.2);
    const rawBpm =
      intervals.length >= 4
        ? calculatePulseRateBpmMedian(intervals)
        : calculatePulseRateBpm(intervals);
    const candidateBpm = medianRr > 0 ? 60_000 / medianRr : rawBpm;

    this.pushDisplayCandidate(timestampMs, candidateBpm, looksCoherent || intervals.length >= 4);
    // directCandidate=true: для trusted источника displayBpm = candidateBpm напрямую, без медианы
    // пула кандидатов за 2.5 с. Пул — второе сглаживание, которое удлиняло «плато» на спаде HR.
    this.updateDisplayBpm(
      timestampMs,
      candidateBpm,
      looksCoherent,
      medianRr,
      intervals.length,
      false,
      false,
      true,
    );

    if (medianRr > 0) this.lastStableMedianRrMs = medianRr;

    return {
      bpm: this.displayBpm,
      rawBpm,
      windowSeconds: PULSE_WINDOW_MS / 1000,
      rrCount: intervals.length,
      medianRrMs: medianRr,
      jitterMs: jitter,
      intervalsMs: intervals,
      looksCoherent,
      lastBeatTimestampMs,
      filteredBeatTimestampsMs,
      reacquiring: false,
      bridgingShortGap: false,
    };
  }

  /** Finger PPG: реконструкция окна с интерполяцией коротких пропаданий. */
  private pushOptical(
    timestampMs: number,
    filtered: readonly RrMeasurement[],
    filteredBeatTimestampsMs: number[],
    lastBeatTimestampMs: number,
    pipelineStableRrMs: number,
    lastTrustedBeatTs: number,
  ): PulseBpmSnapshot {
    // Базовый стабильный RR: последний устойчивый или медиана недавних реальных RR.
    const realWindow = selectRecentRrMeasurements(filtered, timestampMs, PULSE_WINDOW_MS);
    const realIntervals = realWindow.map((m) => m.intervalMs);
    const realMedianRr = median(realIntervals);
    const realJitter = median(realIntervals.map((v) => Math.abs(v - realMedianRr)));
    // Fallback-цепочка: engine.lastStableMedianRrMs → realMedianRr → pipeline baseline.
    // Pipeline baseline (`lastStableRrMs`) переживает finger-off hard-reset и обновляется
    // на любом coherent-окне; без него bridge коротких gap-ов молчит, когда RR-фильтр
    // переотбраковал маргинальный ряд (realMedianRr=0) и engine-у ещё не успел набрать
    // собственный stable RR — короткая потеря сигнала тогда рисует серую полосу.
    const stableRr =
      this.lastStableMedianRrMs > 0
        ? this.lastStableMedianRrMs
        : realMedianRr > 0
          ? realMedianRr
          : pipelineStableRrMs;

    // Реконструированное окно (реальные + интерполированные удары).
    const recon = reconstructOpticalBeatWindow(
      filteredBeatTimestampsMs,
      timestampMs,
      stableRr,
      PULSE_WINDOW_MS,
      lastTrustedBeatTs,
    );
    const reconMeasurements = filterPulseRrMeasurements(
      buildRrMeasurements(recon.beats),
      "fingerCamera",
    );
    const intervals = reconMeasurements.map((m) => m.intervalMs);
    const medianRr = median(intervals);
    const jitter = median(intervals.map((v) => Math.abs(v - medianRr)));

    let reacquiring = recon.reacquiring;
    const bridging = recon.bridging && !reacquiring;

    // RR-drift gate: только реальный ряд может «увести» базовый RR. Резкий (>25 %) сдвиг
    // медианы реального окна при живом сигнале — признак не физиологии, а мусорных RR,
    // удерживаем прошлый BPM. Интерполяция обычно уже сняла краевой артефакт, поэтому
    // этот гейт теперь почти не срабатывает вхолостую.
    if (
      !reacquiring &&
      !bridging &&
      this.lastStableMedianRrMs > 0 &&
      realMedianRr > 0 &&
      realIntervals.length >= 3 &&
      Math.abs(realMedianRr - this.lastStableMedianRrMs) / this.lastStableMedianRrMs > 0.25
    ) {
      reacquiring = true;
    }

    const looksCoherent =
      !reacquiring &&
      realIntervals.length >= 5 &&
      realMedianRr > 0 &&
      realJitter <= Math.max(110, realMedianRr * 0.2);

    const rawBpm =
      intervals.length >= 4
        ? calculatePulseRateBpmMedian(intervals)
        : calculatePulseRateBpm(intervals);
    // Во время bridging кандидат BPM анкерем к stableRr (baseline), а не к смешанной медиане
    // (синтетика + реальные post-gap удары). Post-gap удары первые ~1–2 с часто артефактны
    // (звон bandpass на разрыве, motion от возврата пальца → короткий RR), и смешанная
    // медиана позволяла им вытягивать BPM к ~85 (краевой пик на границе серой полосы),
    // хотя смысл bridge-а — УДЕРЖИВАТЬ последний стабильный ритм пока гэп в окне. Как только
    // гэп устареет из 10-с окна, bridging=false и реальные удары (уже устаканившиеся) снова
    // ведут BPM.
    let candidateBpm = medianRr > 0 ? 60_000 / medianRr : rawBpm;
    if (bridging && stableRr > 0) {
      candidateBpm = 60_000 / stableRr;
    }
    if (!reacquiring) {
      this.pushDisplayCandidate(
        timestampMs,
        candidateBpm,
        looksCoherent || bridging || intervals.length >= 4,
      );
    } else {
      this.dropStaleDisplayCandidates(timestampMs);
    }

    // Обновляем базовый RR только по РЕАЛЬНОМУ когерентному окну (не по интерполяции) и только
    // если сдвиг ≤ 25 % — иначе стойкий мусорный ритм «узаконил» бы себя своим же низким джиттером.
    if (looksCoherent && realMedianRr > 0) {
      this.lastReliableBpmTs = timestampMs;
      if (
        this.lastStableMedianRrMs === 0 ||
        Math.abs(realMedianRr - this.lastStableMedianRrMs) / this.lastStableMedianRrMs <= 0.25
      ) {
        this.lastStableMedianRrMs = realMedianRr;
      }
    }

    this.updateDisplayBpm(
      timestampMs,
      candidateBpm,
      looksCoherent || bridging,
      medianRr,
      intervals.length,
      reacquiring,
      true,
    );

    return {
      bpm: this.displayBpm,
      rawBpm,
      windowSeconds: PULSE_WINDOW_MS / 1000,
      rrCount: intervals.length,
      medianRrMs: medianRr,
      jitterMs: jitter,
      intervalsMs: intervals,
      looksCoherent,
      lastBeatTimestampMs,
      filteredBeatTimestampsMs,
      reacquiring,
      bridgingShortGap: bridging,
    };
  }

  private pushDisplayCandidate(timestampMs: number, bpm: number, reliable: boolean): void {
    if (bpm > 0 && Number.isFinite(bpm)) {
      this.recentDisplayCandidates.push({ timestampMs, bpm, reliable });
    }
    this.dropStaleDisplayCandidates(timestampMs);
  }

  private dropStaleDisplayCandidates(timestampMs: number): void {
    const cutoff = timestampMs - 2_500;
    this.recentDisplayCandidates = this.recentDisplayCandidates.filter(
      (sample) => sample.timestampMs >= cutoff,
    );
  }

  private updateDisplayBpm(
    timestampMs: number,
    candidateBpm: number,
    reliableNow: boolean,
    medianRr: number,
    rrCount: number,
    reacquiring: boolean,
    slewLimited = false,
    directCandidate = false,
  ): void {
    if (reliableNow && candidateBpm > 0) {
      this.lastReliableBpmTs = timestampMs;
    }
    const reliablePool = this.recentDisplayCandidates.filter((sample) => sample.reliable);
    const pool = reliablePool.length >= 3 ? reliablePool : this.recentDisplayCandidates;
    const poolBpm = pool.map((sample) => sample.bpm).filter((value) => value > 0);

    if (reacquiring) {
      // hold previous displayBpm; do not let the stale/settling RR move it
      this.lastDisplayUpdateTs = timestampMs;
      return;
    }

    let target = this.displayBpm;
    if (directCandidate && candidateBpm > 0 && rrCount >= 3) {
      // Trusted source: RR уже отфильтрованы sequential-гейтом, candidateBpm = медиана короткого
      // окна — устойчива к одиночному пропуску. Берём её напрямую, без медианы пула за 2.5 с,
      // иначе быстрый пик/спад HR при нагрузке сглаживался в «плато».
      target = candidateBpm;
    } else if (poolBpm.length >= 3) {
      target = median(poolBpm);
    } else if (this.displayBpm <= 0 && candidateBpm > 0 && rrCount >= 3) {
      target = candidateBpm;
    } else if (
      this.displayBpm > 0 &&
      timestampMs - this.lastReliableBpmTs > 2_500 &&
      candidateBpm > 0 &&
      rrCount >= 3
    ) {
      target = candidateBpm;
    } else if (
      this.displayBpm > 0 &&
      timestampMs - this.lastReliableBpmTs > 8_000 &&
      poolBpm.length === 0
    ) {
      // Полная потеря сигнала дольше ~8 с (и не reacquire, и не бридж) — обнуляем live-readout.
      target = 0;
    }

    if (slewLimited && this.displayBpm > 0 && target > 0 && this.lastDisplayUpdateTs > 0) {
      const dtSec = Math.max(0.05, (timestampMs - this.lastDisplayUpdateTs) / 1000);
      const maxStep = OPTICAL_DISPLAY_MAX_SLEW_BPM_PER_SEC * dtSec;
      target = this.displayBpm + Math.max(-maxStep, Math.min(maxStep, target - this.displayBpm));
    }
    this.displayBpm = target;
    this.lastDisplayUpdateTs = timestampMs;
  }

  reset(): void {
    this.displayBpm = 0;
    this.lastReliableBpmTs = 0;
    this.lastStableMedianRrMs = 0;
    this.lastDisplayUpdateTs = 0;
    this.recentDisplayCandidates = [];
  }
}
