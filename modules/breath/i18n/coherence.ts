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
  /** Пока нет валидной метки времени камеры для окна QC. */
  qualityCheckWaitingTimebase: string;
  /** Оставшиеся секунды окна проверки (1–10), по времени камеры. */
  qualityCheckCountdown: (secondsLeft: number) => string;
  /** Заголовок диалога «QC не прошло». */
  qcFailedDialogTitle: string;
  /** Подзаголовок диалога «QC не прошло». */
  qcFailedDialogMessage: string;
  /** Кнопка диалога: продолжить практику с эмулированным пульсом. */
  qcFailedContinueWithoutSensor: string;
  /** Кнопка диалога: повторить попытку установить контакт. */
  qcFailedRetry: string;
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
  rmssdLabel: string;
  stressLabel: string;
  exportButton: string;
  startButton: string;
  /** Кнопка «Начать без пульсометра» — запускает эмулированный пульс (75→65 BPM). */
  startWithoutSensorButton: string;
  /** Пояснение на экране результатов, когда пульс был эмулирован. */
  emulatedPulseResultsNote: string;
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
    "Удерживайте контакт ≈ 10 с. Нужны: tracking, качество > 70 %, не меньше 6 ударов за окно.",
  qualityCheckWaitingTimebase: "Синхронизация с камерой…",
  qualityCheckCountdown: (s) => `Окно 10 с — осталось ${s} с`,
  qcFailedDialogTitle: "Пульс не распознан",
  qcFailedDialogMessage:
    "Сигнал оказался слишком нестабилен для достоверной оценки ритма. Можно продолжить практику без датчика — тогда ритм дыхания задаёт эмулятор пульса (75 → 65 BPM), а показатели HRV и когерентности не считаются. Либо попробовать ещё раз: прижмите палец плотнее к камере со вспышкой и не двигайтесь.",
  qcFailedContinueWithoutSensor: "Продолжить без пульсометра",
  qcFailedRetry: "Попробовать снова",
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
  rmssdLabel: "RMSSD",
  stressLabel: "Индекс стресса",
  exportButton: "Экспорт JSON (отладка)",
  startButton: "Начать",
  startWithoutSensorButton: "Начать без пульсометра",
  emulatedPulseResultsNote:
    "Пульс эмулировался (датчик не использовался) — метрики HRV, стресса, когерентности и RSA не рассчитываются.",
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
    "Keep contact for ~10 s. Need: tracking, quality > 70 %, at least 6 beats in the window.",
  qualityCheckWaitingTimebase: "Syncing with camera clock…",
  qualityCheckCountdown: (s) => `10 s window — ${s}s left`,
  qcFailedDialogTitle: "Pulse not detected",
  qcFailedDialogMessage:
    "The signal was too unstable for a reliable rhythm estimate. You can continue without a sensor — the breath rhythm will then be driven by the emulated pulse (75 → 65 BPM), and HRV/coherence metrics will not be computed. Or try again: press your finger firmly against the camera with flash and stay still.",
  qcFailedContinueWithoutSensor: "Continue without pulse sensor",
  qcFailedRetry: "Try again",
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
  rmssdLabel: "RMSSD",
  stressLabel: "Stress index",
  exportButton: "Export JSON (debug)",
  startButton: "Start",
  startWithoutSensorButton: "Start without pulse sensor",
  emulatedPulseResultsNote:
    "Pulse was emulated (no sensor used) — HRV, stress, coherence, and RSA are not computed.",
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
