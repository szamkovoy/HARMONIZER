export type BreathLocale = "ru" | "en";

export interface CoherenceBreathStrings {
  inhale: string;
  exhale: string;
  practiceTitle: string;
  calibrationTitle: string;
  warmupTitle: string;
  warmupHint: string;
  qualityCheckTitle: string;
  qualityCheckHint: string;
  qualityCheckWait: string;
  calibrationHint: string;
  calibrationPulse: string;
  calibrationWait: string;
  calibrationTimeout: string;
  simulatedMetricsNote: string;
  durationLabel: string;
  coherenceAvgLabel: string;
  coherenceMaxLabel: string;
  rsaLabel: string;
  rsaNormalizedLabel: string;
  entryTimeLabel: string;
  exportButton: string;
  startButton: string;
  backButton: string;
  approximateMetricsNote: string;
  fingerHint: string;
  /** Одна строка на экране результатов: шкала времени + число ударов в окне (см. JSON debug). */
  debugTimeBaseCamera: string;
  debugTimeBaseUnix: string;
  debugBeatsInWindow: string;
  debugBeatsAfterDedupe: string;
  opticalSeriesCaption: string;
  opticalSimulatedNote: string;
  opticalNoSamples: string;
  /** Оверлей во время практики: нет пальца ≥ 1 с. */
  ppgFingerLostMessage: string;
  /** Слабый сигнал 2–7 с (lock search / SQ &lt; 0.5). */
  ppgWeakSignalMessage: string;
  /** Слабый сигнал &gt; 7 с. */
  ppgBiometryPausedMessage: string;
}

const ru: CoherenceBreathStrings = {
  inhale: "ВДОХ",
  exhale: "ВЫДОХ",
  practiceTitle: "Когерентное дыхание",
  calibrationTitle: "Калибровка пульса",
  warmupTitle: "Прогрев датчика",
  warmupHint: "Держите палец на камере со вспышкой. Идёт прогрев — запись сессии ещё не ведётся.",
  qualityCheckTitle: "Проверка качества сигнала",
  qualityCheckHint:
    "Удерживайте контакт. Нужны: tracking, качество > 70 %, не меньше 3 ударов за 5 с. При сбое окно начнётся снова.",
  qualityCheckWait: "Окно 5 с…",
  calibrationHint:
    "Приложите палец к камере со вспышкой. Дождитесь, пока ритм станет устойчивым — затем начнётся практика.",
  calibrationPulse: "Пульс",
  calibrationWait: "Ждём устойчивый сигнал…",
  calibrationTimeout: "Не удалось получить стабильный пульс. Попробуйте снова.",
  simulatedMetricsNote: "Метрики по смоделированному RR (нет нативного ППГ или режим Expo Go).",
  durationLabel: "Длительность практики",
  coherenceAvgLabel: "Когерентность (средняя)",
  coherenceMaxLabel: "Когерентность (макс.)",
  rsaLabel: "Амплитуда RSA",
  rsaNormalizedLabel: "Нормированная RSA",
  entryTimeLabel: "Время вхождения",
  exportButton: "Экспорт JSON (отладка)",
  startButton: "Начать",
  backButton: "Закрыть",
  approximateMetricsNote:
    "Режим короткой сессии: метрики оценочные (окно анализа сокращено; см. JSON).",
  fingerHint: "Приложите палец к камере со вспышкой для измерения пульса.",
  debugTimeBaseCamera: "Шкала времени: камера (CMTime), не Unix",
  debugTimeBaseUnix: "Шкала времени: системные часы",
  debugBeatsInWindow: "Ударов в окне сессии",
  debugBeatsAfterDedupe: "после дедупликации",
  opticalSeriesCaption: "Optical (detrend, как в пробе ППГ)",
  opticalSimulatedNote: "Нет live optical в режиме симуляции.",
  opticalNoSamples: "Нет optical-сэмплов в снимке",
  ppgFingerLostMessage: "Пульс потерян, биометрия приостановлена",
  ppgWeakSignalMessage: "Слабый сигнал, пульс не прощупывается",
  ppgBiometryPausedMessage: "Биометрия приостановлена, но продолжайте дыхание.",
};

const en: CoherenceBreathStrings = {
  inhale: "INHALE",
  exhale: "EXHALE",
  practiceTitle: "Coherence breath",
  calibrationTitle: "Pulse calibration",
  warmupTitle: "Sensor warmup",
  warmupHint: "Keep your finger on the camera with flash. Warmup in progress — session logging has not started.",
  qualityCheckTitle: "Signal quality check",
  qualityCheckHint:
    "Keep contact. Need: tracking, quality > 70 %, at least 3 beats in 5 s. On failure the window restarts.",
  qualityCheckWait: "5 s window…",
  calibrationHint:
    "Place your finger on the camera with flash. Wait until the rhythm is stable — then practice begins.",
  calibrationPulse: "Pulse",
  calibrationWait: "Waiting for stable signal…",
  calibrationTimeout: "Could not get a stable pulse. Try again.",
  simulatedMetricsNote: "Metrics use simulated RR (no native PPG or Expo Go).",
  durationLabel: "Practice duration",
  coherenceAvgLabel: "Coherence (average)",
  coherenceMaxLabel: "Coherence (peak)",
  rsaLabel: "RSA amplitude",
  rsaNormalizedLabel: "Normalized RSA",
  entryTimeLabel: "Time to entry",
  exportButton: "Export JSON (debug)",
  startButton: "Start",
  backButton: "Close",
  approximateMetricsNote:
    "Short session mode: metrics are approximate (reduced analysis window; see JSON).",
  fingerHint: "Place your finger on the camera with flash for pulse measurement.",
  debugTimeBaseCamera: "Time base: camera (CMTime), not Unix epoch",
  debugTimeBaseUnix: "Time base: system clock",
  debugBeatsInWindow: "Beats in session window",
  debugBeatsAfterDedupe: "after dedupe",
  opticalSeriesCaption: "Optical (detrend, as in PPG probe)",
  opticalSimulatedNote: "No live optical in simulated mode.",
  opticalNoSamples: "No optical samples in snapshot",
  ppgFingerLostMessage: "Pulse lost, biometrics paused",
  ppgWeakSignalMessage: "Weak signal, pulse cannot be felt",
  ppgBiometryPausedMessage: "Biometrics paused — keep breathing.",
};

export function getCoherenceBreathStrings(locale: BreathLocale): CoherenceBreathStrings {
  return locale === "en" ? en : ru;
}
