/**
 * Структурированные входы/выходы модуля BREATH.
 *
 * Эти типы — публичный контракт. Меняй их осторожно: их читают
 * навигация/роутинг, коммуникатор (для «Обсудить»), будущий модуль
 * отчётов и т. д.
 */
import type { CoherenceSessionResult } from "@/modules/breath/core/coherence-session-analysis";
import type { Chakra } from "@/modules/breath/core/chakra";
import type { PracticeHrvMetricsResult } from "@/modules/biofeedback/core/metrics";
import type { BreathLocale, BreathPracticeId } from "@/modules/breath/i18n/coherence";

/**
 * Параметры запуска дыхательной практики.
 *
 * Все поля опциональные, потому что модуль имеет разумные дефолты
 * (когерентное дыхание, 20 мин, третья чакра). Но в проде их стоит
 * задавать явно из вызывающей стороны.
 */
export interface BreathPracticeInput {
  /** ID практики (см. `BreathPracticeId`). */
  practiceId?: BreathPracticeId;
  /**
   * Длительность практики в миллисекундах. По умолчанию —
   * `DEFAULT_COHERENCE_TEST_TIMING.totalMs` (20 мин).
   *
   * Историческое примечание: старый camera-only hybrid start/end режим
   * действительно включался на длинных практиках (от 10 мин), чтобы
   * уменьшить перегрев телефона. В текущем production-flow он выключен:
   * `fingerCamera` работает как guidance-only без advanced metrics, а BLE
   * считает метрики по живому RR-ряду без split-окон.
   */
  durationMs?: number;
  /**
   * На какую чакру направлена практика (1..7). Влияет только на цветовой
   * профиль мандалы; на математику метрик — нет.
   */
  chakra?: Chakra;
  /** Локаль UI. Дефолт — `"ru"`. */
  locale?: BreathLocale;
}

/**
 * Результаты одной завершённой практики.
 *
 * Всегда содержит `summary` (короткую сводку для «Обсудить» и UI-таблицы).
 * Поле `diagnostics` присутствует только при включённом тестовом режиме —
 * в проде его не будет (экономим размер payload-а в communicator).
 */
export interface BreathPracticeOutcome {
  /** Входные параметры, с которыми была запущена практика. */
  input: Required<Pick<BreathPracticeInput, "practiceId" | "durationMs" | "chakra" | "locale">>;
  /** Короткая сводка результата, «то, что видит пользователь в таблице». */
  summary: BreathPracticeSummary;
  /** Полный hybrid-сплит (начало/конец); присутствует всегда. */
  hybrid: BreathHybridBreakdown | null;
  /**
   * Диагностические данные (runtime-телеметрия, список beats, opticalSamples).
   * В проде = null. В тестовом режиме — объект с большим JSON-блобом; именно
   * он экспортируется кнопкой «Экспорт JSON (отладка)».
   */
  diagnostics: unknown | null;
}

/**
 * Короткая сводка результатов — минимально необходимое для UI и «Обсудить».
 */
export interface BreathPracticeSummary {
  /** Фактическая длительность практики (мс). */
  durationMs: number;
  /** Был ли пульс эмулированным (QC не прошёл / Expo Go / симуляция). */
  pulseEmulated: boolean;
  /** Средний пульс за всю практику (уд/мин) или `null` если нет. */
  avgPulseBpm: number | null;
  /** Средняя когерентность по всей практике (0..100) или `null`. */
  coherenceAveragePercent: number | null;
  /** Максимальная когерентность по всей практике (0..100) или `null`. */
  coherenceMaxPercent: number | null;
  /** RSA-амплитуда (BPM) по всей практике или `null`. */
  rsaAmplitudeBpm: number | null;
  /** Нормированная RSA (0..100) или `null`. */
  rsaNormalizedPercent: number | null;
  /** RMSSD (мс) по всей практике или `null`. */
  rmssdMs: number | null;
  /** Stress Index (0..100) или `null`. */
  stressPercent: number | null;
  /** Время вхождения в когерентность (с) или `null`, если не вошёл. */
  entryTimeSec: number | null;
}

/**
 * Разбивка результатов на два окна: начало и конец практики.
 *
 * Это legacy-контракт для старого hybrid camera path. Поле остаётся в
 * payload-е совместимости, но в текущем production-flow обычно `null`:
 * camera advanced metrics выключены, BLE считает один непрерывный ряд.
 */
export interface BreathHybridBreakdown {
  start: BreathWindowMetrics;
  end: BreathWindowMetrics;
}

export interface BreathWindowMetrics {
  /** Длительность окна (мс). */
  windowMs: number;
  /** Средний пульс в окне (уд/мин) или `null`. */
  avgBpm: number | null;
  /** Метрики, которые считает coherence-модуль. */
  coherence: CoherenceSessionResult;
  /** Метрики, которые считает HRV-модуль (RMSSD + stress). */
  hrv: PracticeHrvMetricsResult | null;
}

/**
 * Сериализация результата для отправки в communicator («Обсудить»).
 * Делается отдельно от `BreathPracticeOutcome`, чтобы payload был компактный
 * и не ссылался на JSI-объекты (SkPath, etc.). Результат — plain JSON.
 */
export function outcomeToCommunicatorPayload(outcome: BreathPracticeOutcome): Record<string, unknown> {
  return {
    kind: "breath-practice-outcome",
    input: outcome.input,
    summary: outcome.summary,
    hybrid: outcome.hybrid
      ? {
          start: serializeWindow(outcome.hybrid.start),
          end: serializeWindow(outcome.hybrid.end),
        }
      : null,
  };
}

function serializeWindow(w: BreathWindowMetrics): Record<string, unknown> {
  return {
    windowMs: w.windowMs,
    avgBpm: w.avgBpm,
    coherence: {
      averagePercent: w.coherence.coherenceAveragePercent ?? null,
      maxPercent: w.coherence.coherenceMaxPercent ?? null,
      rsaAmplitudeBpm: w.coherence.rsaAmplitudeBpm ?? null,
      rsaNormalizedPercent: w.coherence.rsaNormalizedPercent ?? null,
      entryTimeSec: w.coherence.entryTimeSec ?? null,
    },
    hrv: w.hrv
      ? {
          rmssdMs: w.hrv.rmssdMs ?? null,
          stressPercent: w.hrv.stressPercent ?? null,
          beatCount: w.hrv.validBeatCount ?? null,
          showRmssd: w.hrv.showRmssd,
          showStress: w.hrv.showStress,
        }
      : null,
  };
}
