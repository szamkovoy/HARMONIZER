/**
 * SessionExporter v3: единый формат экспорта сессии биометрии.
 *
 * Изменения относительно legacy v2 (`buildCoherenceExportJson`):
 *  - schemaVersion = 3;
 *  - `engines[].version` / `engines[].config` — какой алгоритм/параметры применялись;
 *  - `channelLog` — последние N событий каждого канала Bus с временем (для реконструкции
 *    того, что UI видел в какой момент);
 *  - `pipelineSnapshot` — текущее состояние конвейера (merged beats, hrvValid beats, last RR);
 *  - совместимый блок `coherence` — результат финального анализа когерентности (если был),
 *    плюс старая v2-схема `legacyCoherenceJson` для обратной совместимости разбора.
 *
 * Использование:
 *   const json = JSON.stringify(buildSessionExportV3({ bus, pipeline, dataSource: "fingerPpg" }), null, 2);
 */

import type { BiofeedbackBus } from "@/modules/biofeedback/bus/biofeedback-bus";
import type { BiofeedbackPipeline } from "@/modules/biofeedback/bus/biofeedback-pipeline";
import { PIPELINE_ENGINE_VERSIONS } from "@/modules/biofeedback/bus/biofeedback-pipeline";
import type { ChannelMap, ChannelName } from "@/modules/biofeedback/bus/channels";
import {
  COHERENCE_ALGORITHM_VERSION,
  COHERENCE_BEAT_DEDUPE_MS,
  COHERENCE_ENTRY_THRESHOLD_PERCENT,
  ENTRY_STABILITY_SECONDS,
  PRODUCTION_WINDOW_SECONDS,
  PWIN_HALF_WIDTH_HZ,
  PWIN_SEARCH_MAX_HZ,
  PWIN_SEARCH_MIN_HZ,
  PTOTAL_MAX_HZ,
  PTOTAL_MIN_HZ,
  RR_ARTIFACT_DEVIATION,
  RSA_CYCLE_MIN_BPM,
  SMOOTH_WINDOW_SECONDS,
  TACHO_SAMPLE_RATE_HZ,
  TEST120_WINDOW_SECONDS,
} from "@/modules/breath/core/coherence-constants";

export interface SessionExportV3Options {
  bus: BiofeedbackBus;
  pipeline: BiofeedbackPipeline;
  dataSource: "fingerPpg" | "simulated" | "wearable" | "health";
  /** Опциональные пользовательские заметки. */
  userNotes?: string;
  /** Лимит элементов в `channelLog` на один канал (по умолчанию 256). */
  channelLogLimit?: number;
}

const ALL_CHANNELS: ChannelName[] = [
  "beat",
  "pulseBpm",
  "rmssd",
  "stress",
  "coherence",
  "rsa",
  "contact",
  "session",
  "optical",
  "error",
];

export function buildSessionExportV3(opts: SessionExportV3Options) {
  const { bus, pipeline, dataSource, userNotes = "" } = opts;
  const channelLimit = opts.channelLogLimit ?? 256;

  const channelLog: Record<string, unknown[]> = {};
  for (const ch of ALL_CHANNELS) {
    const hist = bus.getHistory(ch as keyof ChannelMap) as unknown[];
    channelLog[ch] = hist.slice(-channelLimit);
  }

  const merged = pipeline.getMergedBeats();
  const hrvValidBeats = pipeline.getHrvAccumulator().getBeats();
  const coherenceEngine = pipeline.getCoherenceEngine();

  let coherence: unknown = null;
  if (coherenceEngine.isActive() || coherenceEngine.getSessionBeats().length > 0) {
    const sessionBeats = coherenceEngine.getSessionBeats();
    coherence = {
      sessionBeats: [...sessionBeats],
      sessionBeatsCount: sessionBeats.length,
      isActive: coherenceEngine.isActive(),
    };
  }

  return {
    schemaVersion: 3 as const,
    exportedAtMs: Date.now(),
    dataSource,
    userNotes,
    engines: {
      hrv: {
        version: PIPELINE_ENGINE_VERSIONS.hrv,
      },
      stress: {
        version: PIPELINE_ENGINE_VERSIONS.stress,
      },
      coherence: {
        version: PIPELINE_ENGINE_VERSIONS.coherence,
        algorithmVersion: COHERENCE_ALGORITHM_VERSION,
        config: {
          tachoSampleRateHz: TACHO_SAMPLE_RATE_HZ,
          windowSecondsTest: TEST120_WINDOW_SECONDS,
          windowSecondsProduction: PRODUCTION_WINDOW_SECONDS,
          smoothWindowSeconds: SMOOTH_WINDOW_SECONDS,
          entryThresholdPercent: COHERENCE_ENTRY_THRESHOLD_PERCENT,
          entryStabilitySeconds: ENTRY_STABILITY_SECONDS,
          rrArtifactDeviation: RR_ARTIFACT_DEVIATION,
          rsaCycleMinBpm: RSA_CYCLE_MIN_BPM,
          beatDedupeMs: COHERENCE_BEAT_DEDUPE_MS,
          pwinSearchMinHz: PWIN_SEARCH_MIN_HZ,
          pwinSearchMaxHz: PWIN_SEARCH_MAX_HZ,
          pwinHalfWidthHz: PWIN_HALF_WIDTH_HZ,
          ptotalMinHz: PTOTAL_MIN_HZ,
          ptotalMaxHz: PTOTAL_MAX_HZ,
        },
      },
      rsa: {
        version: PIPELINE_ENGINE_VERSIONS.rsa,
      },
    },
    pipelineSnapshot: {
      mergedBeatsCount: merged.length,
      mergedBeats: [...merged],
      hrvValidBeatsCount: hrvValidBeats.length,
      hrvValidBeats: [...hrvValidBeats],
      lastSourceTimestampMs: pipeline.getLastSourceTimestampMs(),
      lastStableRrMs: pipeline.getLastStableRrMs(),
      lockState: pipeline.getLockState(),
    },
    channelLog,
    coherence,
  };
}
