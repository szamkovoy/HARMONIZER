import {
  FINGER_CAMERA_CAPTURE_CONFIG,
  type FingerSignalSnapshot,
  type HrvPracticeTier,
} from "@/modules/biofeedback/core/types";

/** Начало записи сессии: 10 с прогрева + 10 с калибровки (пульс стабилен ~с 20-й секунды). */
export const FINGER_SESSION_RECORDING_START_MS = 20_000;
/** Завершение сессии: палец снят дольше этого времени (мс). */
export const FINGER_SESSION_END_ABSENT_MS = 10_000;
/** На экране видно ~15 с сигнала при горизонтальном скролле. */
export const SESSION_CHART_VIEWPORT_SECONDS = 15;

export type FingerSessionSample = {
  timestampMs: number;
  /** Порядковый номер кадра внутри `FingerSignalAnalyzer` (монотонно растёт за сессию анализатора). */
  analyzerFrameIndex: number;
  redMean: number;
  greenMean: number;
  blueMean: number;
  lumaMean: number;
  /** red - 0.35*g - 0.15*b (как в analyzer). */
  opticalCombined: number;
  baseline: number;
  detrended: number;
  /** Bandpass 0.8–2.5 Hz + лёгкое сглаживание (как для пиков). */
  ppgBandpassed: number;
  signalStatus: FingerSignalSnapshot["signalStatus"];
  signalQuality: number;
  fingerPresenceConfidence: number;
  motion: number;
  redDominance: number;
  darknessRatio: number;
  saturationRatio: number;
  pulseLockState: FingerSignalSnapshot["pulseLockState"];
  pulseLockConfidence: number;
  pulseReady: boolean;
  pulseCalibrationComplete: boolean;
  pulseRateBpmSnapshot: number;
  rawPulseRateBpm: number;
  rmssdReady: boolean;
  rmssdMs: number;
  stressReady: boolean;
  stressIndex: number;
  detectedBeatCount: number;
  candidatePeakCount: number;
  acceptedPeakCount: number;
  rejectedPeakCount: number;
  medianRrMs: number;
  rrIntervalCount: number;
  /** Хвост интервалов RR на этом кадре (для отладки без полной истории). */
  rrIntervalsMsTail: number[];
  hrvEligibleBeatCount: number;
  hrvExtrapolatedBeatCount: number;
  hrvMinDisplayEligibleBeats: number;
  hrvMinFullEligibleBeats: number;
  hrvPracticeTier: HrvPracticeTier;
  hrvRmssdApproximate: boolean;
  hrvStressApproximate: boolean;
  hrvShowInitialFinal: boolean;
  hrvInitialRmssdMs: number;
  hrvInitialStressIndex: number;
  hrvFinalRmssdMs: number;
  hrvFinalStressIndex: number;
  hrvSessionEndCaptured: boolean;
  hrvSessionEndInitialRmssdMs: number;
  hrvSessionEndFinalRmssdMs: number;
  hrvSessionEndInitialStressIndex: number;
  hrvSessionEndFinalStressIndex: number;
};

export type FingerSessionExport = {
  schemaVersion: 2;
  exportedAtMs: number;
  /** Первый сэмпл значимого окна (после 20 с контакта). */
  sessionStartedAtMs: number;
  /** Последний сэмпл до завершения (палец >10 с вне). */
  sessionEndedAtMs: number;
  durationMs: number;
  sampleCount: number;
  opticalFormula: "redMean - 0.35*greenMean - 0.15*blueMean";
  filterNote: "Bandpass Butterworth 4th 0.8-2.5 Hz (SOS), zero-phase filtfilt equivalent; then MA(3)";
  /** Конфиг анализатора на момент экспорта (для воспроизведения порогов). */
  analyzerConfig: {
    targetFps: number;
    minPulseBpm: number;
    maxPulseBpm: number;
    pulseBandHz: { min: number; max: number };
  };
  /** ППГ ≠ ЭКГ: объёмный пульс против электрической активности; форма и фазы другие. */
  debug: {
    ppgVsEcgNote: string;
    howToTransferToDesktop: string;
  };
  userNotes: string;
  samples: FingerSessionSample[];
};

export function buildFingerSessionExport(
  samples: readonly FingerSessionSample[],
  userNotes: string,
): FingerSessionExport | null {
  if (samples.length === 0) {
    return null;
  }

  const sessionStartedAtMs = samples[0].timestampMs;
  const sessionEndedAtMs = samples[samples.length - 1].timestampMs;

  return {
    schemaVersion: 2,
    exportedAtMs: Date.now(),
    sessionStartedAtMs,
    sessionEndedAtMs,
    durationMs: sessionEndedAtMs - sessionStartedAtMs,
    sampleCount: samples.length,
    opticalFormula: "redMean - 0.35*greenMean - 0.15*blueMean",
    filterNote:
      "Bandpass Butterworth 4th 0.8-2.5 Hz (SOS), zero-phase filtfilt equivalent; then MA(3)",
    analyzerConfig: {
      targetFps: FINGER_CAMERA_CAPTURE_CONFIG.targetFps,
      minPulseBpm: FINGER_CAMERA_CAPTURE_CONFIG.minPulseBpm,
      maxPulseBpm: FINGER_CAMERA_CAPTURE_CONFIG.maxPulseBpm,
      pulseBandHz: {
        min: FINGER_CAMERA_CAPTURE_CONFIG.pulseBand.minHz,
        max: FINGER_CAMERA_CAPTURE_CONFIG.pulseBand.maxHz,
      },
    },
    debug: {
      ppgVsEcgNote:
        "PPG (камера/палец) отражает объёмный пульс крови; ЭКГ — электрическую активность сердца. Ожидать совпадения формы с кардиограммой нельзя; цель — стабильные интервалы и правдоподобная огибающая без артефактов.",
      howToTransferToDesktop:
        "После «Экспорт JSON» откроется системное меню: AirDrop, Mail, Telegram, Files, «Сохранить в файлы». На Mac откройте JSON и перетащите в чат Cursor или приложите в письме. Файл содержит рядом сырые усреднения ROI и обработанный ppgBandpassed для графика.",
    },
    userNotes,
    samples: [...samples],
  };
}

export function snapshotToSessionSample(snapshot: FingerSignalSnapshot): FingerSessionSample {
  const tail = snapshot.rrIntervalsMs.slice(-24);
  return {
    timestampMs: snapshot.timestampMs,
    analyzerFrameIndex: snapshot.sampleCount,
    redMean: snapshot.redMean,
    greenMean: snapshot.greenMean,
    blueMean: snapshot.blueMean,
    lumaMean: snapshot.lumaMean,
    opticalCombined: snapshot.opticalValue,
    baseline: snapshot.baseline,
    detrended: snapshot.detrendedValue,
    ppgBandpassed: snapshot.ppgBandpassedValue,
    signalStatus: snapshot.signalStatus,
    signalQuality: snapshot.signalQuality,
    fingerPresenceConfidence: snapshot.fingerPresenceConfidence,
    motion: snapshot.motion,
    redDominance: snapshot.redDominance,
    darknessRatio: snapshot.darknessRatio,
    saturationRatio: snapshot.saturationRatio,
    pulseLockState: snapshot.pulseLockState,
    pulseLockConfidence: snapshot.pulseLockConfidence,
    pulseReady: snapshot.pulseReady,
    pulseCalibrationComplete: snapshot.pulseCalibrationComplete,
    pulseRateBpmSnapshot: snapshot.pulseRateBpm,
    rawPulseRateBpm: snapshot.rawPulseRateBpm,
    rmssdReady: snapshot.rmssdReady,
    rmssdMs: snapshot.rmssdMs,
    stressReady: snapshot.stressReady,
    stressIndex: snapshot.stressIndex,
    detectedBeatCount: snapshot.detectedBeatCount,
    candidatePeakCount: snapshot.candidatePeakCount,
    acceptedPeakCount: snapshot.acceptedPeakCount,
    rejectedPeakCount: snapshot.rejectedPeakCount,
    medianRrMs: snapshot.medianRrMs,
    rrIntervalCount: snapshot.rrIntervalsMs.length,
    rrIntervalsMsTail: tail,
    hrvEligibleBeatCount: snapshot.hrvEligibleBeatCount,
    hrvExtrapolatedBeatCount: snapshot.hrvExtrapolatedBeatCount,
    hrvMinDisplayEligibleBeats: snapshot.hrvMinDisplayEligibleBeats,
    hrvMinFullEligibleBeats: snapshot.hrvMinFullEligibleBeats,
    hrvPracticeTier: snapshot.hrvPracticeTier,
    hrvRmssdApproximate: snapshot.hrvRmssdApproximate,
    hrvStressApproximate: snapshot.hrvStressApproximate,
    hrvShowInitialFinal: snapshot.hrvShowInitialFinal,
    hrvInitialRmssdMs: snapshot.hrvInitialRmssdMs,
    hrvInitialStressIndex: snapshot.hrvInitialStressIndex,
    hrvFinalRmssdMs: snapshot.hrvFinalRmssdMs,
    hrvFinalStressIndex: snapshot.hrvFinalStressIndex,
    hrvSessionEndCaptured: snapshot.hrvSessionEndCaptured,
    hrvSessionEndInitialRmssdMs: snapshot.hrvSessionEndInitialRmssdMs,
    hrvSessionEndFinalRmssdMs: snapshot.hrvSessionEndFinalRmssdMs,
    hrvSessionEndInitialStressIndex: snapshot.hrvSessionEndInitialStressIndex,
    hrvSessionEndFinalStressIndex: snapshot.hrvSessionEndFinalStressIndex,
  };
}
