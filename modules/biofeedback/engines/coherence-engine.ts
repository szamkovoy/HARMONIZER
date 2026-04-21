/**
 * CoherenceEngine: stateful обёртка над `runCoherenceSessionAnalysis`.
 *
 * Контракт:
 *  - Engine не считает математику сам — вся логика (дедуп, очистка RR, тахограмма 4 Гц,
 *    FFT по секундам, медианный фильтр 3 с, RSA, время вхождения) живёт в
 *    [modules/breath/core/coherence-session-analysis.ts](../../breath/core/coherence-session-analysis.ts).
 *  - На каждый удар (`appendBeat`) или периодически (`tick`) engine может пересчитать
 *    результат для активной сессии.
 *  - При завершении сессии (`finalize`) выдаёт полный `CoherenceSessionResult`.
 *
 * Это даёт нам гарантированную parity с текущей реализацией коги/RSA: формулы не дублируются.
 */

import {
  COHERENCE_BEAT_DEDUPE_MS,
  RR_ARTIFACT_DEVIATION,
  RSA_CYCLE_MIN_BPM,
  TACHO_SAMPLE_RATE_HZ,
} from "@/modules/breath/core/coherence-constants";
import {
  beatsToEvents,
  buildCoherenceExportJson,
  runCoherenceSessionAnalysis,
  type BreathAnalysisMode,
  type CoherenceExportDebug,
  type CoherencePulseLogEntry,
  type CoherenceSessionInput,
  type CoherenceSessionResult,
} from "@/modules/breath/core/coherence-session-analysis";
import {
  buildTachogramBpmSeries,
  cleanRrSequenceCoherence,
} from "@/modules/breath/core/tachogram-4hz";

export const COHERENCE_ENGINE_VERSION = "engine/coherence@1.0";

/**
 * Лёгкий срез живых метрик для `BreathPhasePlanner` и UI footer. Во время активной
 * сессии мы НЕ считаем coherence % / RMSSD / стресс / entry-time / smoothedSeries —
 * всё это **результаты** практики и считаются один раз в `finalize()`.
 *
 * Почему так: при 20-минутной практике полный live-анализ коги каждую секунду (даже
 * инкрементальный) копит работу: `beatsToEvents` + `cleanRrSequenceCoherence` по
 * всей истории ударов (1500+), `medianFilter1HzWindowSeconds` по серии длины T,
 * два линейных прохода для агрегатов и entry-time. Всё вместе на каждом тике даёт
 * десятки тысяч операций, и за сессию суммарно **O(T²)** — именно это выражалось
 * в торможении мандалы и рывках индикатора к 10-й минуте.
 *
 * Для дыхания нам нужно **только одно** live-число: `lastCompletedRsaCycle` для
 * `BreathPhasePlanner` (и его медиана для UI-строки RSA). Считаем **только на
 * закрытии каждого дыхательного цикла**, на окне **одного** цикла (~10–15 с,
 * ≈40–60 тахогрм-сэмплов). Итого за сессию: O(cycles × cycle_size) = O(T), линейно.
 */
export interface CoherenceLiveSnapshot {
  /** Последний завершённый активный RSA-цикл (для `BreathPhasePlanner`). */
  lastCompletedRsaCycle: {
    hrInhale: number;
    hrExhale: number;
    rsaBpm: number;
    durationMs: number;
  } | null;
  /** Медиана размаха BPM по последним до 5 активных циклам (для UI footer). */
  rsaMedianBpmRecent: number | null;
  /**
   * Монотонно растёт при закрытии каждого нового активного RSA-цикла. Pipeline
   * использует это, чтобы **не публиковать** coherence-событие на шину, если ни
   * одного нового цикла не закрылось — UI тогда не ре-рендерится.
   */
  revision: number;
}

interface LiveRsaCycle {
  cycleIndex: number;
  startMs: number;
  endMs: number;
  hrMax: number;
  hrMin: number;
  rsaBpm: number;
  inactive: boolean;
  durationMs: number;
}

/** Максимум последних активных RSA-циклов, по которым берём медиану для UI. */
const RSA_RECENT_WINDOW = 5;

/**
 * Собирает подмассив отсортированных timestamps в диапазоне [lowMs, highMs].
 * O(log N) на поиск нижней границы + O(k) на копирование, где k — число
 * элементов в окне. Не копирует всю историю, что критично для live-пути.
 */
function collectBeatsInRange(
  sortedBeats: readonly number[],
  lowMs: number,
  highMs: number,
): number[] {
  const n = sortedBeats.length;
  if (n === 0) return [];
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedBeats[mid]! < lowMs) lo = mid + 1;
    else hi = mid;
  }
  const out: number[] = [];
  for (let i = lo; i < n; i += 1) {
    const t = sortedBeats[i]!;
    if (t > highMs) break;
    out.push(t);
  }
  return out;
}

interface LiveState {
  cycleMs: number;
  lastProcessedRsaCycleIdx: number;
  /**
   * Кольцевой буфер последних `RSA_RECENT_WINDOW` **активных** циклов — достаточно
   * для медианы. Хранить всю историю циклов во время сессии бессмысленно: они попадут
   * в финальный результат через `runCoherenceSessionAnalysis()` в `finalize()`.
   */
  recentActiveRsaCycles: LiveRsaCycle[];
  cachedSnapshot: CoherenceLiveSnapshot;
  revision: number;
}

export interface CoherenceSessionStartOptions {
  sessionStartedAtMs: number;
  inhaleMs: number;
  exhaleMs: number;
  /** Полная длительность цикла (мс) — нужно указывать для практик с задержками. */
  cycleMs?: number;
  mode: BreathAnalysisMode;
  /** Метки из QC-окна перед T=0 (для тахограммы — буфер). */
  preflightBeats?: readonly number[];
  bufferMsBeforeSession?: number;
}

export class CoherenceEngine {
  private active = false;
  private sessionStartedAtMs = 0;
  private inhaleMs = 5000;
  private exhaleMs = 5000;
  private cycleMs: number | undefined;
  private mode: BreathAnalysisMode = "test120s";
  private bufferMsBeforeSession = 0;
  /** Полный merged ряд ударов за сессию (с буфером QC). Растёт от каждого `appendBeat`. */
  private sessionBeats: number[] = [];
  /** Маска принудительных нулей по секундам (плохой сигнал → BPM = 0 на тахограмме). */
  private secondBpmForcedZero: boolean[] = [];
  /** Последний кэшированный результат (для интервалов между finalize). */
  private cachedResult: CoherenceSessionResult | null = null;
  /**
   * Инкрементальное live-состояние. Ведётся параллельно с `sessionBeats`, обновляется
   * только на новые истекшие секунды в `tickLive(nowMs)`. После `finalize()` — очищается.
   */
  private live: LiveState | null = null;

  /** Стартует новую сессию. Очищает накопители. */
  startSession(opts: CoherenceSessionStartOptions): void {
    this.active = true;
    this.sessionStartedAtMs = opts.sessionStartedAtMs;
    this.inhaleMs = opts.inhaleMs;
    this.exhaleMs = opts.exhaleMs;
    this.cycleMs = opts.cycleMs;
    this.mode = opts.mode;
    this.bufferMsBeforeSession = opts.bufferMsBeforeSession ?? 0;
    this.sessionBeats = [];
    if (opts.preflightBeats?.length) {
      this.sessionBeats.push(...opts.preflightBeats);
    }
    this.secondBpmForcedZero = [];
    this.cachedResult = null;
    this.live = {
      cycleMs: opts.cycleMs ?? opts.inhaleMs + opts.exhaleMs,
      lastProcessedRsaCycleIdx: 0,
      recentActiveRsaCycles: [],
      cachedSnapshot: {
        lastCompletedRsaCycle: null,
        rsaMedianBpmRecent: null,
        revision: 0,
      },
      revision: 0,
    };
  }

  /**
   * Инкрементально добавляет новые удары из merged-ленты в активную сессию.
   *
   * Раньше реализация делала `[...sessionBeats, ...merged]` + полный `dedupeBeatTimestampsMs`
   * **на каждый optical sample (30 Hz)**. Для сессии в 20+ минут это O(N) копия + O(N) дедуп,
   * 30 раз в секунду, при растущем N — фактически квадратичная нагрузка, сильно грела CPU.
   *
   * Теперь добавляем только те удары из `merged`, у которых timestamp > последнего в
   * `sessionBeats + COHERENCE_BEAT_DEDUPE_MS`. Оба массива отсортированы по возрастанию,
   * дедуп внутри `merged` обеспечивает beat-merger. Итого — O(M) на вызов, где M — лишь
   * несколько новых ударов за 30 мс кадра. Семантика совпадает: старая функция
   * `dedupeBeatTimestampsMs` оставлена ниже как fallback для snapshot/finalize.
   */
  appendBeats(merged: readonly number[]): void {
    if (!this.active || merged.length === 0) return;
    let lastTs = this.sessionBeats.length > 0
      ? this.sessionBeats[this.sessionBeats.length - 1]!
      : -Infinity;
    const minGap = COHERENCE_BEAT_DEDUPE_MS;
    for (let i = 0; i < merged.length; i += 1) {
      const t = merged[i]!;
      if (t <= lastTs + minGap) continue;
      this.sessionBeats.push(t);
      lastTs = t;
    }
  }

  /** Помечает секунду относительно session start как «не считать BPM» (плохой сигнал). */
  forceSecondBpmZero(secondIndex: number, totalSeconds: number): void {
    if (!this.active) return;
    if (this.secondBpmForcedZero.length < totalSeconds) {
      const fill = new Array(totalSeconds - this.secondBpmForcedZero.length).fill(false);
      this.secondBpmForcedZero.push(...fill);
    }
    if (secondIndex >= 0 && secondIndex < this.secondBpmForcedZero.length) {
      this.secondBpmForcedZero[secondIndex] = true;
    }
  }

  /**
   * Снапшот текущей когерентности (для UI: «вот сейчас столько процентов»).
   *
   * ВНИМАНИЕ: это **тяжёлый** путь — выполняет полный сессионный анализ, что при
   * длинных практиках даёт O(T²) нагрузку. Оставлен для совместимости и отладочных
   * сценариев. В hot-path (1 Hz публикация на шине, live-RSA) используйте
   * {@link tickLive}, который обрабатывает только новые секунды.
   */
  snapshot(nowMs: number): CoherenceSessionResult | null {
    if (!this.active) return null;
    return this.runAnalysis(nowMs);
  }

  /**
   * Минимально необходимый live-тик для `BreathPhasePlanner` и UI-строки RSA. Не
   * считает coherence % / RMSSD / стресс / entry-time / smoothedSeries — эти
   * метрики **результатные** и вычисляются один раз в `finalize()`.
   *
   * Сложность: O(1), если ни один новый дыхательный цикл не закрылся с прошлого
   * тика (≈14 из 15 тиков секундной публикации). Когда цикл закрылся — O(M_cycle),
   * где M_cycle — число ударов в одном дыхательном цикле (≈10–20 штук), НЕ в
   * размере всей сессии. Суммарно за сессию — O(T_seconds), строго линейно.
   *
   * Вызывающему нужно проверить `revision`: если оно не увеличилось — ничего
   * нового не произошло, можно не публиковать событие на шину и не ре-рендерить UI.
   */
  tickLive(nowMs: number): CoherenceLiveSnapshot | null {
    if (!this.active || this.live == null) return null;
    const live = this.live;
    const cycleMs = live.cycleMs;
    if (cycleMs <= 0) return live.cachedSnapshot;

    const nextCycleEndMs =
      this.sessionStartedAtMs + (live.lastProcessedRsaCycleIdx + 1) * cycleMs;
    if (nextCycleEndMs > nowMs) {
      // Ещё ни одного нового цикла не закрылось — возвращаем кэш без работы.
      return live.cachedSnapshot;
    }

    // Закрылся хотя бы один цикл. Обрабатываем окна по одному — каждое окно это
    // всего ~10–20 ударов. Ищем их в отсортированном `sessionBeats` двумя
    // указателями, не пересобирая всю историю.
    const expectedSamplesPerCycle = Math.max(
      1,
      Math.round((cycleMs / 1000) * TACHO_SAMPLE_RATE_HZ),
    );
    const minSamplesForRsaCycle = Math.ceil(expectedSamplesPerCycle * 0.8);

    let produced = false;
    while (true) {
      const idx = live.lastProcessedRsaCycleIdx;
      const t0 = this.sessionStartedAtMs + idx * cycleMs;
      const t1 = t0 + cycleMs;
      if (t1 > nowMs) break;

      // Берём beats одного цикла с небольшим захватом соседних (для медианы RR в
      // `cleanRrSequenceCoherence` — ей нужны ближайшие соседи, иначе первый/
      // последний удар в окне будет воспринят как «одиночный»).
      const padMs = 2_000;
      const lowT = t0 - padMs;
      const highT = t1 + padMs;
      const cycleBeats = collectBeatsInRange(this.sessionBeats, lowT, highT);
      if (cycleBeats.length >= 2) {
        const events = beatsToEvents(cycleBeats, { sortIfNeeded: false });
        const { cleaned } = cleanRrSequenceCoherence(events, RR_ARTIFACT_DEVIATION);
        const { bpm: cycleBpm } = buildTachogramBpmSeries(
          cleaned,
          t0,
          t1,
          TACHO_SAMPLE_RATE_HZ,
        );
        if (cycleBpm.length >= minSamplesForRsaCycle) {
          let hrMax = -Infinity;
          let hrMin = Infinity;
          for (let i = 0; i < cycleBpm.length; i += 1) {
            const v = cycleBpm[i]!;
            if (v > hrMax) hrMax = v;
            if (v < hrMin) hrMin = v;
          }
          const rsaBpm = hrMax - hrMin;
          const entry: LiveRsaCycle = {
            cycleIndex: idx,
            startMs: t0,
            endMs: t1,
            hrMax,
            hrMin,
            rsaBpm,
            inactive: rsaBpm < RSA_CYCLE_MIN_BPM,
            durationMs: cycleMs,
          };
          if (!entry.inactive) {
            live.recentActiveRsaCycles.push(entry);
            if (live.recentActiveRsaCycles.length > RSA_RECENT_WINDOW) {
              live.recentActiveRsaCycles.shift();
            }
            produced = true;
          }
        }
      }
      live.lastProcessedRsaCycleIdx = idx + 1;
    }

    if (!produced) {
      return live.cachedSnapshot;
    }

    const lastActive = live.recentActiveRsaCycles[live.recentActiveRsaCycles.length - 1]!;
    const sorted = live.recentActiveRsaCycles
      .map((c) => c.rsaBpm)
      .sort((a, b) => a - b);
    const rsaMedianBpmRecent = sorted[Math.floor(sorted.length / 2)]!;

    live.revision += 1;
    live.cachedSnapshot = {
      lastCompletedRsaCycle: {
        hrInhale: lastActive.hrMax,
        hrExhale: lastActive.hrMin,
        rsaBpm: lastActive.rsaBpm,
        durationMs: lastActive.durationMs,
      },
      rsaMedianBpmRecent,
      revision: live.revision,
    };
    return live.cachedSnapshot;
  }

  /** Последний кэшированный live-снимок (без пересчёта). null, если сессия не активна. */
  getLiveSnapshot(): CoherenceLiveSnapshot | null {
    return this.live?.cachedSnapshot ?? null;
  }

  /** Финализирует сессию: вызывается по окончании практики; результат кэшируется. */
  finalize(sessionEndedAtMs: number): CoherenceSessionResult {
    if (!this.active) {
      throw new Error("CoherenceEngine.finalize() called without active session");
    }
    this.active = false;
    this.cachedResult = this.runAnalysis(sessionEndedAtMs);
    // live-состояние больше не нужно; освобождаем память.
    this.live = null;
    return this.cachedResult;
  }

  /**
   * Coherence-анализ по произвольному окну [startMs, endMs] с использованием
   * накопленных `sessionBeats` и настроек сессии (inhale/exhale/cycleMs/mode).
   *
   * В отличие от `finalize()`, не меняет состояние engine (не помечает
   * сессию неактивной, не кэширует результат). Используется гибридным
   * режимом измерения для независимого анализа начального и конечного
   * окон реального PPG-замера — без усреднения между ними.
   *
   * Важно: `beatTimestampsMs` передаётся ПОЛНЫЙ ряд `sessionBeats`, а
   * `runCoherenceSessionAnalysis` внутри себя фильтрует удары по
   * [sessionStartedAtMs - buffer, sessionEndedAtMs]. Это гарантирует,
   * что для каждого окна анализ видит удары только своего диапазона.
   */
  analyzeWindow(startMs: number, endMs: number): CoherenceSessionResult {
    const input: CoherenceSessionInput = {
      sessionStartedAtMs: startMs,
      sessionEndedAtMs: endMs,
      beatTimestampsMs: this.sessionBeats,
      inhaleMs: this.inhaleMs,
      exhaleMs: this.exhaleMs,
      cycleMs: this.cycleMs,
      mode: this.mode,
      bufferMsBeforeSession: this.bufferMsBeforeSession,
      secondBpmForcedZero: this.secondBpmForcedZero,
    };
    return runCoherenceSessionAnalysis(input);
  }

  /** Полный JSON для экспорта (legacy v2 schema). v3 — отдельный SessionExporter. */
  buildExportJson(
    sessionEndedAtMs: number,
    options?: {
      dataSource?: "fingerPpg" | "simulated";
      debug?: CoherenceExportDebug;
      pulseLog?: readonly CoherencePulseLogEntry[];
    },
  ) {
    const result = this.cachedResult ?? this.finalize(sessionEndedAtMs);
    const input: CoherenceSessionInput = {
      sessionStartedAtMs: this.sessionStartedAtMs,
      sessionEndedAtMs,
      beatTimestampsMs: this.sessionBeats,
      inhaleMs: this.inhaleMs,
      exhaleMs: this.exhaleMs,
      cycleMs: this.cycleMs,
      mode: this.mode,
      bufferMsBeforeSession: this.bufferMsBeforeSession,
      secondBpmForcedZero: this.secondBpmForcedZero,
    };
    return buildCoherenceExportJson(input, result, options);
  }

  /** Полный набор сырых ударов за сессию (для экспорта v3). */
  getSessionBeats(): readonly number[] {
    return this.sessionBeats;
  }

  /**
   * Из snapshot'а текущей сессии вытаскивает **последний завершённый** RSA-цикл —
   * используется `BreathPhasePlanner` для корректировки длительностей следующего цикла.
   * null — если активной сессии нет или ни один цикл ещё не закрыт.
   *
   * Трактовка: в `CoherenceSessionResult` фиксируются `hrMax`/`hrMin` на окне одного
   * дыхательного цикла; «вдох в начале цикла» приводит к подъёму HR → `hrMax ≈ hrInhale`,
   * «выдох во второй половине» — к спаду → `hrMin ≈ hrExhale`.
   */
  extractLastCompletedRsaCycle(snapshotResult: CoherenceSessionResult | null):
    | { hrInhale: number; hrExhale: number; rsaBpm: number; durationMs: number }
    | null {
    if (!snapshotResult) return null;
    for (let i = snapshotResult.rsaCycles.length - 1; i >= 0; i -= 1) {
      const c = snapshotResult.rsaCycles[i]!;
      if (c.inactive) continue;
      return {
        hrInhale: c.hrMax,
        hrExhale: c.hrMin,
        rsaBpm: c.rsaBpm,
        durationMs: c.endMs - c.startMs,
      };
    }
    return null;
  }

  reset(): void {
    this.active = false;
    this.sessionStartedAtMs = 0;
    this.inhaleMs = 5000;
    this.exhaleMs = 5000;
    this.cycleMs = undefined;
    this.mode = "test120s";
    this.bufferMsBeforeSession = 0;
    this.sessionBeats = [];
    this.secondBpmForcedZero = [];
    this.cachedResult = null;
    this.live = null;
  }

  isActive(): boolean {
    return this.active;
  }

  private runAnalysis(endMs: number): CoherenceSessionResult {
    const input: CoherenceSessionInput = {
      sessionStartedAtMs: this.sessionStartedAtMs,
      sessionEndedAtMs: endMs,
      beatTimestampsMs: this.sessionBeats,
      inhaleMs: this.inhaleMs,
      exhaleMs: this.exhaleMs,
      cycleMs: this.cycleMs,
      mode: this.mode,
      bufferMsBeforeSession: this.bufferMsBeforeSession,
      secondBpmForcedZero: this.secondBpmForcedZero,
    };
    return runCoherenceSessionAnalysis(input);
  }
}
