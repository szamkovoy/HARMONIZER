import { inlineBaseLocale, type AppContentLocale } from "@/modules/i18n/localeCodes";

export interface BiofeedbackDebugStrings {
  title: string;
  subtitle: string;
  startCapture: string;
  stopCapture: string;
  exportCapture: string;
  selectWearable: string;
  changeWearable: string;
  selectedWearable: (name: string) => string;
  noWearableSelected: string;
  captureHint: string;
  fingerSourceTitle: string;
  wearableSourceTitle: string;
  pulseChartTitle: string;
  rrChartTitle: string;
  stateLabel: string;
  contactLabel: string;
  lockLabel: string;
  beatsLabel: string;
  lastRrLabel: string;
  rmssdLabel: string;
  stressLabel: string;
  coherenceLabel: string;
  rsaLabel: string;
  emptyChart: string;
}

const ru: BiofeedbackDebugStrings = {
  title: "Стенд сверки биометрии",
  subtitle:
    "Параллельное сравнение пульса и RR: палец на камере телефона против нагрудного датчика Polar.",
  startCapture: "Начать сравнение",
  stopCapture: "Остановить",
  exportCapture: "Экспорт JSON",
  selectWearable: "Выбрать пульсометр",
  changeWearable: "Сменить пульсометр",
  selectedWearable: (name) => `Пульсометр: ${name}`,
  noWearableSelected: "Пульсометр не выбран",
  captureHint:
    "Экран использует тот же biofeedback pipeline, но отдельно от основной дыхательной практики.",
  fingerSourceTitle: "Камера телефона",
  wearableSourceTitle: "Bluetooth-пульсометр",
  pulseChartTitle: "Пульс (BPM)",
  rrChartTitle: "RR-интервалы (мс)",
  stateLabel: "Состояние",
  contactLabel: "Контакт",
  lockLabel: "Lock",
  beatsLabel: "Удары",
  lastRrLabel: "Последний RR",
  rmssdLabel: "RMSSD",
  stressLabel: "Стресс",
  coherenceLabel: "Coherence",
  rsaLabel: "RSA",
  emptyChart: "Недостаточно точек для графика.",
};

const en: BiofeedbackDebugStrings = {
  title: "Biometric parity bench",
  subtitle:
    "Parallel comparison of pulse and RR: finger on the phone camera versus the Polar chest strap.",
  startCapture: "Start comparison",
  stopCapture: "Stop",
  exportCapture: "Export JSON",
  selectWearable: "Select heart strap",
  changeWearable: "Change heart strap",
  selectedWearable: (name) => `Heart strap: ${name}`,
  noWearableSelected: "No heart strap selected",
  captureHint:
    "This screen uses the same biofeedback pipeline, but isolated from the main breathing practice flow.",
  fingerSourceTitle: "Phone camera",
  wearableSourceTitle: "Bluetooth chest strap",
  pulseChartTitle: "Pulse (BPM)",
  rrChartTitle: "RR intervals (ms)",
  stateLabel: "State",
  contactLabel: "Contact",
  lockLabel: "Lock",
  beatsLabel: "Beats",
  lastRrLabel: "Last RR",
  rmssdLabel: "RMSSD",
  stressLabel: "Stress",
  coherenceLabel: "Coherence",
  rsaLabel: "RSA",
  emptyChart: "Not enough points for a chart.",
};

export function getBiofeedbackDebugStrings(locale: AppContentLocale): BiofeedbackDebugStrings {
  return inlineBaseLocale(locale) === "ru" ? ru : en;
}
