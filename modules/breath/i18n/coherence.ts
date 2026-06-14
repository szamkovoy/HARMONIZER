import type { AppContentLocale } from "@/modules/i18n/localeCodes";
import { mergeTypedLocale } from "@/modules/i18n/typed/merge";

export type BreathLocale = AppContentLocale;

export interface CoherenceBreathStrings {
  inhale: string;
  exhale: string;
  /** Третья фаза для квадрата/треугольников. */
  hold: string;
  /** Суффикс секунд — «сек»/«sec» (отображается под ВДОХ/ВЫДОХ/ЗАДЕРЖКА). */
  secondsShortLabel: string;
  /**
   * Подпись длительности фазы в **ударах пульса**: `5 → «5 ударов»`, `1 → «1 удар»`.
   * Используется под ВДОХ/ВЫДОХ/ЗАДЕРЖКА, чтобы число совпадало с выбранным на панели.
   */
  beatsShortLabel: (count: number) => string;
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
  /**
   * Объединённый экран «прогрев + QC» для пользователя: одно название, одна инструкция.
   * Сам прогрев и проверка качества — деталь реализации, не выносим её в UI.
   */
  sensorActivationTitle: string;
  sensorActivationHint: string;
  /** Строка под таймером «Ожидание устойчивого сигнала…». */
  sensorActivationStableWait: string;
  /** Надпись над пиктограммой поиска сигнала (пока палец не на объективе). */
  sensorActivationFingerSearch: string;
  /** Заголовок диалога «QC не прошло». */
  qcFailedDialogTitle: string;
  /** Подзаголовок диалога «QC не прошло». */
  qcFailedDialogMessage: string;
  /** Кнопка диалога: продолжить практику с эмулированным пульсом. */
  qcFailedContinueWithoutSensor: string;
  /** Кнопка диалога: повторить попытку установить контакт. */
  qcFailedRetry: string;
  /**
   * Ссылка для отправки отладочного JSON разработчику (бета-период).
   * Отображается только при `DEBUG_ACTIVATION_EXPORT_ENABLED=true`.
   * Будет удалена до публичного релиза.
   */
  qcFailedSendReport: string;
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
  /**
   * «Базовый пульс» — скользящая EMA по RR-интервалам из BreathPhasePlanner.
   * Самая устойчивая оценка «твоего текущего пульса», без per-секундных
   * флуктуаций. Показываем тренд: `72 → 80` за практику.
   */
  baselineBpmTrendLabel: string;
  /** Средний пульс за окно (начало / конец). */
  avgBpmLabel: string;
  /** Заголовок колонки «в начале практики» в таблице результатов. */
  resultsWindowStartLabel: string;
  /** Заголовок колонки «в конце практики» в таблице результатов. */
  resultsWindowEndLabel: string;
  /** Подпись под заголовком колонки: длительность реального измерения (мм:сс). */
  resultsWindowDurationLabel: (minutes: number, seconds: number) => string;
  /** Пояснение на экране результатов, что в середине практики пульс эмулировался. */
  hybridEmulatedMidNote: string;
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
  /** Короткий суффикс длительности на панели управления: «МИН» / «MIN». */
  practiceMinutesShort: string;
  /** Авто-стоп: практика прервана из-за потери доверия к сигналу / фона. */
  autoAbortTitle: string;
  autoAbortMessage: string;
  autoAbortStartAgain: string;
  autoAbortExit: string;
  /** Диалог подтверждения досрочного выхода из практики. */
  stopConfirmTitle: string;
  stopConfirmMessage: string;
  stopConfirmYes: string;
  stopConfirmNo: string;
  /** Accessibility-подсказка для счётчика базового числа ударов на фазу. */
  baseBeatsAccessibilityLabel: string;
  /** Заголовок на панели idle — выбор типа практики. */
  practicePickerTitle: string;
  /** Универсальная кнопка «Отменить». */
  cancelButton: string;
  /** Отображаемые имена практик (на родном языке). */
  practiceName: Record<BreathPracticeId, string>;
  /** Санскритские подзаголовки практик. */
  practiceSanskritName: Record<BreathPracticeId, string>;

  // ─── Экран результатов: mood-picker + кнопки «Обсудить/Закрыть» ────────
  /** Вопрос перед показом таблицы результатов. */
  resultsMoodQuestion: string;
  /** Подпись под «весёлым» смайлом. */
  resultsMoodBetter: string;
  /** Подпись под нейтральным смайлом. */
  resultsMoodSame: string;
  /** Подпись под «грустным» смайлом. */
  resultsMoodWorse: string;
  /** Заголовок раздела с метриками после выбора настроения. */
  resultsMetricsHeader: string;
  /** Кнопка «Обсудить» — открывает коммуникатор с результатами практики. */
  resultsDiscussButton: string;
  /** Кнопка «Закрыть» — возврат на главный экран. */
  resultsCloseButton: string;
  /**
   * Системный промпт, с которым открывается коммуникатор при нажатии «Обсудить».
   */
  resultsDiscussSystemPrompt: string;
  /**
   * Вводная строка пользовательского сообщения при обсуждении результатов.
   * Полный текст = это + JSON-блок с метриками.
   */
  resultsDiscussUserIntro: string;
}

/**
 * Идентификаторы всех поддерживаемых дыхательных практик. Держим их в i18n, чтобы
 * зависимые строки нельзя было «забыть» локализовать — при добавлении нового id
 * TypeScript потребует строки для всех языков.
 */
export type BreathPracticeId =
  | "coherent"
  | "nadi-shodhana"
  | "surya-bhedana"
  | "chandra-bhedana"
  | "square"
  | "triangle-up"
  | "triangle-down";

const ru: CoherenceBreathStrings = {
  inhale: "ВДОХ",
  exhale: "ВЫДОХ",
  hold: "ЗАДЕРЖКА",
  secondsShortLabel: "сек",
  beatsShortLabel: (count: number) => `${count} уд.пульса`,
  practiceTitle: "Когерентное дыхание",
  calibrationTitle: "Калибровка пульса",
  warmupTitle: "Прогрев датчика",
  warmupHint: "Держите палец на камере со вспышкой. Идёт прогрев — запись сессии ещё не ведётся.",
  qualityCheckTitle: "Проверка качества сигнала",
  qualityCheckHint:
    "Удерживайте контакт ≈ 10 с. Нужны: tracking, качество > 70 %, не меньше 6 ударов за окно.",
  qualityCheckWaitingTimebase: "Синхронизация с камерой…",
  qualityCheckCountdown: (s) => `Окно 10 с — осталось ${s} с`,
  sensorActivationTitle: "Активация пульсометра",
  sensorActivationHint:
    "Кладите подушечку указательного пальца на 5 секунд по очереди на разные объективы телефона, пока внизу на графике не увидите пульсацию. Далее удерживайте палец на этом объективе, не двигая им в течение всей практики.",
  sensorActivationStableWait: "Ожидание устойчивого сигнала…",
  sensorActivationFingerSearch: "Ищу палец на объективе…",
  qcFailedDialogTitle: "Пульс не распознан",
  qcFailedDialogMessage:
    "Стабильный сигнал не получен. Не двигайте палец и не давите им на объектив слишком сильно. Вы можете повторить попытку активировать пульсометр или выполните практику без использования биологической обратной связи.",
  qcFailedContinueWithoutSensor: "Продолжить без пульсометра",
  qcFailedRetry: "Попробовать снова",
  qcFailedSendReport: "Отправить отчёт разработчику",
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
  baselineBpmTrendLabel: "Базовый пульс",
  avgBpmLabel: "Средний пульс",
  resultsWindowStartLabel: "В начале",
  resultsWindowEndLabel: "В конце",
  resultsWindowDurationLabel: (m, s) =>
    `${m}:${s.toString().padStart(2, "0")} замера`,
  hybridEmulatedMidNote:
    "Метрики ниже рассчитаны по двум окнам реальных PPG-замеров — в начале и в конце практики. Середина практики использовалась для свободного дыхания и не входит в итоговую аналитику.",
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
  practiceMinutesShort: "минут",
  autoAbortTitle: "Практика остановлена",
  autoAbortMessage:
    "При переключении в другие приложения прерывается считывание пульса. Но вы можете начать практику сначала.",
  autoAbortStartAgain: "Начать сначала",
  autoAbortExit: "Выйти",
  stopConfirmTitle: "Завершить практику?",
  stopConfirmMessage:
    "Практика будет остановлена, а результаты по текущему отрезку не будут рассчитаны.",
  stopConfirmYes: "Завершить",
  stopConfirmNo: "Продолжить",
  baseBeatsAccessibilityLabel: "Количество ударов пульса на фазу дыхания",
  practicePickerTitle: "Тип дыхательной практики",
  cancelButton: "Отменить",
  practiceName: {
    coherent: "Когерентное дыхание",
    "nadi-shodhana": "Попеременное дыхание ноздрями",
    "surya-bhedana": "Дыхание правой ноздрёй",
    "chandra-bhedana": "Дыхание левой ноздрёй",
    square: "Дыхание «Квадрат»",
    "triangle-up": "Треугольник вершиной вверх",
    "triangle-down": "Треугольник вершиной вниз",
  },
  practiceSanskritName: {
    coherent: "Сама-Вритти",
    "nadi-shodhana": "Нади Шодхана",
    "surya-bhedana": "Сурья Бхедана",
    "chandra-bhedana": "Чандра Бхедана",
    square: "Чатуранга пранаяма",
    "triangle-up": "Висама-Вритти · Бахир Кумбхака",
    "triangle-down": "Висама-Вритти · Антар Кумбхака",
  },
  resultsMoodQuestion: "Как изменилось ваше состояние?",
  resultsMoodBetter: "стало лучше",
  resultsMoodSame: "осталось прежним",
  resultsMoodWorse: "стало хуже",
  resultsMetricsHeader: "Ваши показатели",
  resultsDiscussButton: "Обсудить",
  resultsCloseButton: "Закрыть",
  resultsDiscussSystemPrompt:
    "Ты эмпатичный наставник дыхательных практик в приложении Harmonizer. " +
    "Когда пользователь делится с тобой результатами практики, ты кратко и тепло " +
    "поддерживаешь, выделяешь положительные изменения и динамику, избегаешь " +
    "медицинских выводов и не ставишь диагнозов. Пиши по-русски, без эмодзи, " +
    "коротко (2–4 предложения). После ответа — пригласи задать уточняющие вопросы.",
  resultsDiscussUserIntro:
    "Вот результаты моей только что завершённой дыхательной практики. " +
    "Пожалуйста, выдели положительные моменты и прокомментируй динамику.",
};

const en: CoherenceBreathStrings = {
  inhale: "INHALE",
  exhale: "EXHALE",
  hold: "HOLD",
  secondsShortLabel: "sec",
  beatsShortLabel: (count: number) => `${count} pulse beats`,
  practiceTitle: "Coherence breath",
  calibrationTitle: "Pulse calibration",
  warmupTitle: "Sensor warmup",
  warmupHint: "Keep your finger on the camera with flash. Warmup in progress — session logging has not started.",
  qualityCheckTitle: "Signal quality check",
  qualityCheckHint:
    "Keep contact for ~10 s. Need: tracking, quality > 70 %, at least 6 beats in the window.",
  qualityCheckWaitingTimebase: "Syncing with camera clock…",
  qualityCheckCountdown: (s) => `10 s window — ${s}s left`,
  sensorActivationTitle: "Pulse sensor activation",
  sensorActivationHint:
    "Press the tip of your index finger for about 5 seconds on each of your phone's cameras in turn until you see a pulsation on the chart below. Then keep the finger still on that lens for the whole practice.",
  sensorActivationStableWait: "Waiting for a stable signal…",
  sensorActivationFingerSearch: "Looking for a finger on the lens…",
  qcFailedDialogTitle: "Pulse not detected",
  qcFailedDialogMessage:
    "A stable signal was not obtained. Keep the finger still and don't press too hard against the lens. You can try the sensor again or run the practice without biofeedback.",
  qcFailedContinueWithoutSensor: "Continue without pulse sensor",
  qcFailedRetry: "Try again",
  qcFailedSendReport: "Send debug report to developer",
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
  baselineBpmTrendLabel: "Baseline heart rate",
  avgBpmLabel: "Average pulse",
  resultsWindowStartLabel: "Start",
  resultsWindowEndLabel: "End",
  resultsWindowDurationLabel: (m, s) =>
    `${m}:${s.toString().padStart(2, "0")} of measurement`,
  hybridEmulatedMidNote:
    "Mid-practice the pulse was emulated to reduce device load. The metrics below are computed from real measurements at the start and end of the practice.",
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
  practiceMinutesShort: "min",
  autoAbortTitle: "Practice stopped",
  autoAbortMessage:
    "Switching to other apps interrupts pulse readings. You can start the practice again.",
  autoAbortStartAgain: "Start again",
  autoAbortExit: "Exit",
  stopConfirmTitle: "End practice?",
  stopConfirmMessage:
    "The session will be stopped and results for the current run will not be computed.",
  stopConfirmYes: "End",
  stopConfirmNo: "Continue",
  baseBeatsAccessibilityLabel: "Pulse beats per breathing phase",
  practicePickerTitle: "Breathing practice",
  cancelButton: "Cancel",
  practiceName: {
    coherent: "Coherent breathing",
    "nadi-shodhana": "Alternate nostril breathing",
    "surya-bhedana": "Right-nostril breathing",
    "chandra-bhedana": "Left-nostril breathing",
    square: "Square breathing",
    "triangle-up": "Triangle (apex up)",
    "triangle-down": "Triangle (apex down)",
  },
  practiceSanskritName: {
    coherent: "Sama Vritti",
    "nadi-shodhana": "Nadi Shodhana",
    "surya-bhedana": "Surya Bhedana",
    "chandra-bhedana": "Chandra Bhedana",
    square: "Chaturanga pranayama",
    "triangle-up": "Vishama Vritti · Bahir Kumbhaka",
    "triangle-down": "Vishama Vritti · Antar Kumbhaka",
  },
  resultsMoodQuestion: "How has your state changed?",
  resultsMoodBetter: "got better",
  resultsMoodSame: "stayed the same",
  resultsMoodWorse: "got worse",
  resultsMetricsHeader: "Your metrics",
  resultsDiscussButton: "Discuss",
  resultsCloseButton: "Close",
  resultsDiscussSystemPrompt:
    "You are an empathetic breathing-practice mentor in the Harmonizer app. " +
    "When the user shares practice results, respond briefly and warmly, highlight " +
    "positive changes and dynamics, avoid medical conclusions and diagnoses. " +
    "Write in English, no emoji, 2–4 sentences. End by inviting follow-up questions.",
  resultsDiscussUserIntro:
    "Here are the results of my just-completed breathing practice. " +
    "Please highlight positive aspects and comment on the dynamics.",
};

export function getCoherenceBreathStrings(locale: BreathLocale): CoherenceBreathStrings {
  const base = locale === "en" ? en : ru;
  return mergeTypedLocale("breath", base, locale);
}
