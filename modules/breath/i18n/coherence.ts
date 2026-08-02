import { inlineBaseLocale, type AppContentLocale } from "@/modules/i18n/localeCodes";
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
  /** График реального измеренного пульса на экране результатов. */
  resultsMeasuredPulseLabel: string;
  /** График пульса, по которому практика фактически вела дыхание. */
  resultsGuidancePulseLabel: string;
  /** Тахограмма R–R (мс) под графиком пульса — только отображение. */
  resultsRrIntervalsLabel: string;
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
  /** Крупный заголовок результатов, когда практика шла без пульсометра. */
  noSensorGreatPracticeTitle: string;
  /** Рекомендация на экране результатов без пульсометра (телефон или BLE в следующий раз). */
  noSensorResultsRecommendation: string;
  /** Камера телефона ведёт практику только по пульсу. */
  cameraGuidanceOnlyResultsNote: string;
  /** Finger-сигнал годится для пульса и HRV, но не для coherence/RSA. */
  guidedLimitedResultsNote: string;
  /** Finger-сигнал слишком нестабилен для финальной биометрии. */
  pulseOnlyResultsNote: string;
  /** Общая сессия испортилась, но сохранён последний надёжный хвост HRV. */
  recoveredTailHrvResultsNote: string;
  /** Общая сессия испортилась, но coherence/RSA сохранены по tail-окну. */
  recoveredTailCoherenceResultsNote: (minutes: number, seconds: number) => string;
  backButton: string;
  approximateMetricsNote: string;
  fingerHint: string;
  /** Одна строка на экране результатов: шкала времени + число ударов в окне (см. JSON debug). */
  debugTimeBaseCamera: string;
  debugTimeBaseUnix: string;
  debugBeatsInWindow: string;
  debugBeatsAfterDedupe: string;
  opticalSeriesCaption: string;
  cameraRunningGuidanceOnly: string;
  opticalSimulatedNote: string;
  opticalNoSamples: string;
  /** Мягкое напоминание в camera guidance-only режиме после длительной потери сигнала. */
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
  wearableIdleHint: string;
  wearableIdleStartButton: string;
  wearableActivationTitle: string;
  /** Short label shown while BLE prep waits for the first live pulse. */
  sessionPreparationLabel: string;
  wearableActivationSelectedHint: (deviceName: string) => string;
  wearableActivationNoDeviceHint: string;
  wearableBluetoothOff: string;
  wearableConnecting: string;
  /** Short status while connecting a named strap. */
  wearableConnectingWithName: (deviceName: string) => string;
  /** Android: one-line hint if the system «Запрос подключения» banner appears. */
  wearableAndroidSystemConnectHint: string;
  wearableReadyGuidedOnly: string;
  wearableReadyFullMetrics: string;
  wearableScanning: string;
  wearableBluetoothLabel: string;
  wearableRssiLabel: string;
  wearableCapabilityMetrics: string;
  wearableCapabilityRhythmOnly: string;
  wearableCapabilityProbe: string;
  wearableNoDevicesFound: string;
  wearableRetryScan: string;
  wearableUseCamera: string;
  wearableRunningReconnect: string;
  wearableRunningGuidedOnly: string;
  wearableRunningDisconnected: string;
  wearableQcFailedTitle: string;
  wearableQcFailedMessage: string;
  wearablePickerTitle: string;
  wearablePickerSearchHint: string;
  wearablePickerFoundHint: string;
  wearablePickerNotFoundHint: string;
  wearablePickerNotFoundTips: string;
  wearablePickerSelectButton: string;
  wearablePickerConnectedLabel: string;
  wearablePickerDisconnectButton: string;
  wearablePickerCloseButton: string;
  wearablePickerFaultyMessage: string;
  /** Отображаемые имена практик (на родном языке). */
  practiceName: Record<BreathPracticeId, string>;
  /** Санскритские подзаголовки практик. */
  practiceSanskritName: Record<BreathPracticeId, string>;

  // ─── Экран результатов: mood-picker + интерпретация/закрытие ───────────
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
  /** Кнопка перехода к локальной интерпретации результатов. */
  resultsDiscussButton: string;
  /** Текст загрузки интерпретации. */
  resultsInterpretationLoading: string;
  /** Ошибка при запросе интерпретации. */
  resultsInterpretationError: string;
  /** Кнопка повтора после ошибки загрузки интерпретации. */
  resultsInterpretationRetryButton: string;
  /** Пояснение, что для интерпретации нужен BLE-пульсометр с биометрикой. */
  resultsInterpretationRequiresBleNote: string;
  /** Пояснение, что в этой сессии недостаточно биометрии для интерпретации. */
  resultsInterpretationRequiresMetricsNote: string;
  /** Кнопка «Закрыть» — возврат на главный экран. */
  resultsCloseButton: string;
  /**
   * Legacy: системный промпт старого handoff в communicator.
   */
  resultsDiscussSystemPrompt: string;
  /**
   * Legacy: вводная строка пользовательского сообщения для старого handoff.
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
  practiceTitle: "Полное дыхание",
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
  resultsMeasuredPulseLabel: "Пульс (измерение)",
  resultsGuidancePulseLabel: "Пульс (ведение практики)",
  resultsRrIntervalsLabel: "R-R интервалы",
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
  noSensorGreatPracticeTitle: "Практика завершена",
  noSensorResultsRecommendation:
    "Практика выполнена без пульсометра. Если вы хотите получать лучшие результаты от выполнения дыхательных практик, используйте пульсометр. У большинства современных моделей телефонов встроенной камеры достаточно для управления дыхательной практикой на основе биологической обратной связи. Если камера вашего телефона эту функцию не поддерживает или если вы хотите получать расширенные метрики: вариабельность сердечного ритма (RMSSD), дыхательная синусовая аритмия (RSA), индекс стресса Баевского, коэффициент когерентности — подключите Bluetooth пульсометр Polar H10. Могут подойти и другие Bluetooth пульсометры, особенно нагрудные, но с ними приложение не тестировалось.",
  cameraGuidanceOnlyResultsNote:
    "Практика выполнена по пульсу с камеры телефона. Для камеры расширенные метрики HRV, когерентности и RSA отключены; чтобы получить их, используйте совместимый Bluetooth-пульсометр.",
  guidedLimitedResultsNote:
    "Сигнал пальца был нестабилен: практика продолжалась по базовому пульсу, RMSSD и стресс сохранены, а когерентность и RSA скрыты.",
  pulseOnlyResultsNote:
    "Сигнал пальца оказался слишком нестабилен для итоговой биометрии: практика продолжалась по пульсу, но финальные метрики скрыты.",
  recoveredTailHrvResultsNote:
    "К концу практики сигнал пальца испортился, поэтому сохранены последние надёжные значения RMSSD и индекса стресса из чистого хвоста измерения.",
  recoveredTailCoherenceResultsNote: (m, s) =>
    `К концу практики сигнал пальца испортился, поэтому когерентность и RSA сохранены по последнему надёжному фрагменту ${m}:${s.toString().padStart(2, "0")}.`,
  backButton: "Закрыть",
  approximateMetricsNote:
    "Режим короткой сессии: метрики оценочные (окно анализа сокращено; см. JSON).",
  fingerHint: "Приложите палец к камере со вспышкой для измерения пульса.",
  debugTimeBaseCamera: "Шкала времени: камера (CMTime), не Unix",
  debugTimeBaseUnix: "Шкала времени: системные часы",
  debugBeatsInWindow: "Ударов в окне сессии",
  debugBeatsAfterDedupe: "после дедупликации",
  opticalSeriesCaption: "Optical (detrend, как в пробе ППГ)",
  cameraRunningGuidanceOnly:
    "Камера ведёт дыхание по пульсу. Расширенные метрики доступны с BLE-пульсометром.",
  opticalSimulatedNote: "Нет live optical в режиме симуляции.",
  opticalNoSamples: "Нет optical-сэмплов в снимке",
  ppgFingerLostMessage:
    "Держите палец плотнее на камере, чтобы рисунок дыхания точно соответствовал вашему пульсу.",
  ppgWeakSignalMessage: "Слабый сигнал, пульс не прощупывается",
  ppgBiometryPausedMessage: "Сигнал нестабилен, но продолжайте дыхание.",
  practiceMinutesShort: "минут",
  autoAbortTitle: "Практика остановлена",
  autoAbortMessage:
    "При переключении в другие приложения прерывается считывание пульса. Но вы можете начать практику сначала.",
  autoAbortStartAgain: "Начать сначала",
  autoAbortExit: "Выйти",
  stopConfirmTitle: "Завершить практику?",
  stopConfirmMessage:
    "Практика будет остановлена, а результаты по прошедшему отрезку не будут засчитаны.",
  stopConfirmYes: "Завершить",
  stopConfirmNo: "Продолжить",
  baseBeatsAccessibilityLabel: "Количество ударов пульса на фазу дыхания",
  practicePickerTitle: "Тип дыхательной практики",
  cancelButton: "Отменить",
  wearableIdleHint: "Подключите нагрудный BLE-пульсометр или переключитесь на камеру телефона.",
  wearableIdleStartButton: "Подключить пульсометр",
  wearableActivationTitle: "Подключение пульсометра",
  sessionPreparationLabel: "Подготовка",
  wearableActivationSelectedHint: (deviceName) =>
    `Выбран датчик: ${deviceName}. Держите ремень на груди и дождитесь устойчивого потока пульса.`,
  wearableActivationNoDeviceHint:
    "Найдите и выберите BLE-пульсометр. Подключение выполняется внутри приложения, а не через системный список Bluetooth-устройств.",
  wearableBluetoothOff: "Bluetooth выключен. Включите его и повторите поиск.",
  wearableConnecting: "Подключаем пульсометр…",
  wearableConnectingWithName: (deviceName) => `Подключаем ${deviceName}…`,
  wearableAndroidSystemConnectHint: "Если сверху запрос Android — подтвердите соединение.",
  wearableReadyGuidedOnly: "Датчик подключен. Будем вести практику по пульсу без HRV-метрик.",
  wearableReadyFullMetrics: "Датчик подключен. Полные биометрические метрики доступны.",
  wearableScanning: "Ищем совместимые пульсометры поблизости...",
  wearableBluetoothLabel: "Bluetooth",
  wearableRssiLabel: "RSSI",
  wearableCapabilityMetrics: "метрики",
  wearableCapabilityRhythmOnly: "только ритм",
  wearableCapabilityProbe: "проверка",
  wearableNoDevicesFound:
    "Подходящие BLE-пульсометры пока не найдены. Повторите поиск или выберите камеру телефона.",
  wearableRetryScan: "Повторить поиск",
  wearableUseCamera: "Камера",
  wearableRunningReconnect: "Пульсометр переподключается…",
  wearableRunningGuidedOnly: "Метрики HRV отключены: датчик ведёт только ритм дыхания.",
  wearableRunningDisconnected: "Связь с пульсометром потеряна.",
  wearableQcFailedTitle: "Пульсометр не готов",
  wearableQcFailedMessage:
    "Не удалось получить устойчивый поток данных от BLE-пульсометра. Вы можете повторить поиск, попробовать другой датчик или продолжить практику без сенсора.",
  wearablePickerTitle: "Выбор пульсометра",
  wearablePickerSearchHint: "Ищем совместимый Bluetooth-пульсометр рядом с вами...",
  wearablePickerFoundHint: "Пульсометр найден. Выберите устройство для подключения.",
  wearablePickerNotFoundHint: "Пульсометр не найден. Попробуйте повторить поиск.",
  wearablePickerNotFoundTips:
    "При использовании нагрудного пульсометра: смочите контакты, прижмите его к коже и подождите 5–10 секунд, убедитесь что Bluetooth включен, закройте другие приложения, использующие этот пульсометр. Если датчик ещё не сопряжён с телефоном, откройте приложение производителя и дождитесь сопряжения. При необходимости перезагрузите телефон.",
  wearablePickerSelectButton: "Подключить",
  wearablePickerConnectedLabel: "Подключен",
  wearablePickerDisconnectButton: "Отключить",
  wearablePickerCloseButton: "Закрыть",
  wearablePickerFaultyMessage:
    "Выбранный пульсометр работает некорректно. Чтобы продолжить практику, выберите другой пульсометр.",
  practiceName: {
    coherent: "Полное дыхание",
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
  resultsDiscussButton: "Интерпретация",
  resultsInterpretationLoading: "Готовлю интерпретацию результатов...",
  resultsInterpretationError: "Не удалось получить интерпретацию. Попробуйте ещё раз чуть позже.",
  resultsInterpretationRetryButton: "Попробовать снова",
  resultsInterpretationRequiresBleNote:
    "Вы можете получать полезную интерпретацию того, как практика влияет на индекс стресса, RMSSD, когерентность и RSA. Для этого используйте Bluetooth-пульсометр, например Polar H10.",
  resultsInterpretationRequiresMetricsNote:
    "Интерпретация доступна, когда во время практики удалось надёжно определить биометрические метрики. Если они не появились, попробуйте совместимый Bluetooth-пульсометр с RR-интервалами.",
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
  practiceTitle: "Full breathing",
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
  resultsMeasuredPulseLabel: "Pulse (measured)",
  resultsGuidancePulseLabel: "Pulse (guidance)",
  resultsRrIntervalsLabel: "R-R intervals",
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
  noSensorGreatPracticeTitle: "Practice complete",
  noSensorResultsRecommendation:
    "This practice was completed without a pulse sensor. For better results, use a pulse sensor. On most modern phones the built-in camera is enough to guide the breathing practice with biofeedback. If your phone camera does not support this, or if you want advanced metrics — heart-rate variability (RMSSD), respiratory sinus arrhythmia (RSA), Baevsky stress index, and coherence — connect a Polar H10 Bluetooth heart-rate monitor. Other Bluetooth monitors, especially chest straps, may work, but they have not been tested with the app.",
  cameraGuidanceOnlyResultsNote:
    "This practice used the phone camera for pulse. Advanced HRV, coherence, and RSA metrics are disabled for camera mode; use a compatible Bluetooth heart-rate sensor to get them.",
  guidedLimitedResultsNote:
    "Finger signal was unstable: the practice continued on baseline pulse, RMSSD and stress were kept, but coherence and RSA are hidden.",
  pulseOnlyResultsNote:
    "Finger signal was too unstable for final biometrics: the practice continued on pulse guidance, but final metrics are hidden.",
  recoveredTailHrvResultsNote:
    "Finger signal degraded near the end of the practice, so the last reliable RMSSD and stress values were preserved from the clean tail of the measurement.",
  recoveredTailCoherenceResultsNote: (m, s) =>
    `Finger signal degraded near the end of the practice, so coherence and RSA were preserved from the last reliable ${m}:${s.toString().padStart(2, "0")} tail window.`,
  backButton: "Close",
  approximateMetricsNote:
    "Short session mode: metrics are approximate (reduced analysis window; see JSON).",
  fingerHint: "Place your finger on the camera with flash for pulse measurement.",
  debugTimeBaseCamera: "Time base: camera (CMTime), not Unix epoch",
  debugTimeBaseUnix: "Time base: system clock",
  debugBeatsInWindow: "Beats in session window",
  debugBeatsAfterDedupe: "after dedupe",
  opticalSeriesCaption: "Optical (detrend, as in PPG probe)",
  cameraRunningGuidanceOnly:
    "Camera is guiding breathing from pulse. Advanced metrics require a BLE heart-rate sensor.",
  opticalSimulatedNote: "No live optical in simulated mode.",
  opticalNoSamples: "No optical samples in snapshot",
  ppgFingerLostMessage:
    "Keep your finger steady on the camera so the breathing pattern matches your pulse more precisely.",
  ppgWeakSignalMessage: "Weak signal, pulse cannot be felt",
  ppgBiometryPausedMessage: "Signal is unstable — keep breathing.",
  practiceMinutesShort: "min",
  autoAbortTitle: "Practice stopped",
  autoAbortMessage:
    "Switching to other apps interrupts pulse readings. You can start the practice again.",
  autoAbortStartAgain: "Start again",
  autoAbortExit: "Exit",
  stopConfirmTitle: "End practice?",
  stopConfirmMessage:
    "The session will be stopped and results for the elapsed segment will not be counted.",
  stopConfirmYes: "End",
  stopConfirmNo: "Continue",
  baseBeatsAccessibilityLabel: "Pulse beats per breathing phase",
  practicePickerTitle: "Breathing practice",
  cancelButton: "Cancel",
  wearableIdleHint: "Connect a BLE chest strap or switch back to the phone camera.",
  wearableIdleStartButton: "Connect heart strap",
  wearableActivationTitle: "Connect heart-rate strap",
  sessionPreparationLabel: "Preparation",
  wearableActivationSelectedHint: (deviceName) =>
    `Selected device: ${deviceName}. Keep the strap on your chest and wait for a stable pulse stream.`,
  wearableActivationNoDeviceHint:
    "Scan and select a BLE heart-rate strap. Connection is handled inside the app, not through the system Bluetooth device list.",
  wearableBluetoothOff: "Bluetooth is off. Turn it on and try scanning again.",
  wearableConnecting: "Connecting heart-rate monitor…",
  wearableConnectingWithName: (deviceName) => `Connecting ${deviceName}…`,
  wearableAndroidSystemConnectHint: "If Android asks above — confirm the connection.",
  wearableReadyGuidedOnly: "Sensor connected. Breathing will follow pulse, but HRV metrics stay off.",
  wearableReadyFullMetrics: "Sensor connected. Full biometric metrics are available.",
  wearableScanning: "Scanning for compatible heart-rate straps nearby...",
  wearableBluetoothLabel: "Bluetooth",
  wearableRssiLabel: "RSSI",
  wearableCapabilityMetrics: "metrics",
  wearableCapabilityRhythmOnly: "rhythm only",
  wearableCapabilityProbe: "probe",
  wearableNoDevicesFound:
    "No suitable BLE heart-rate straps have been found yet. Retry the scan or switch to the phone camera.",
  wearableRetryScan: "Scan again",
  wearableUseCamera: "Camera",
  wearableRunningReconnect: "Heart-rate strap is reconnecting…",
  wearableRunningGuidedOnly: "HRV metrics are paused: this sensor currently drives rhythm only.",
  wearableRunningDisconnected: "Connection to the heart-rate strap was lost.",
  wearableQcFailedTitle: "Heart-rate strap is not ready",
  wearableQcFailedMessage:
    "A stable BLE heart-rate stream could not be established. You can retry, try another device, or continue without a sensor.",
  wearablePickerTitle: "Choose heart-rate monitor",
  wearablePickerSearchHint: "Scanning for a compatible Bluetooth heart-rate monitor nearby...",
  wearablePickerFoundHint: "Heart-rate monitor found. Select a device to connect.",
  wearablePickerNotFoundHint: "Heart-rate monitor not found. Try scanning again.",
  wearablePickerNotFoundTips:
    "For a chest strap heart-rate monitor: moisten the contacts, press it against your skin and wait 5–10 seconds, make sure Bluetooth is on, and close other apps using this monitor. If the sensor is not yet paired with the phone, open the manufacturer's app and wait until it is paired. Restart the phone if needed.",
  wearablePickerSelectButton: "Connect",
  wearablePickerConnectedLabel: "Connected",
  wearablePickerDisconnectButton: "Disconnect",
  wearablePickerCloseButton: "Close",
  wearablePickerFaultyMessage:
    "The selected heart-rate monitor is not working correctly. Choose another monitor to continue the practice.",
  practiceName: {
    coherent: "Full breathing",
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
  resultsDiscussButton: "Interpretation",
  resultsInterpretationLoading: "Preparing your results interpretation...",
  resultsInterpretationError: "Couldn't load the interpretation. Please try again a little later.",
  resultsInterpretationRetryButton: "Try again",
  resultsInterpretationRequiresBleNote:
    "You can get useful feedback on how the practice affects stress, RMSSD, coherence, and RSA when you use a Bluetooth heart-rate monitor such as the Polar H10.",
  resultsInterpretationRequiresMetricsNote:
    "Interpretation is available when the session produced reliable biometrics. If they are missing, try a compatible Bluetooth heart-rate monitor that provides RR intervals.",
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
  const base = inlineBaseLocale(locale) === "en" ? en : ru;
  return mergeTypedLocale("breath", base, locale);
}
