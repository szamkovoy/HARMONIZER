/**
 * Возвращает soft_cap для диалога, учитывая сценарий и тариф.
 * Источник правды — переменные окружения с fallback на information_axes.json.
 */

import informationAxesJson from "@/data/information_axes.json";

export type SoftCapTier = "free" | "trial" | "premium";

interface InformationAxesSlice {
  soft_cap?: number;
}

interface InformationAxesJson {
  calibration?: InformationAxesSlice;
  daily_dialog?: InformationAxesSlice;
}

const informationAxes = informationAxesJson as InformationAxesJson;

export function getSoftCap(useCase: string, tier: SoftCapTier): number {
  // 1. Калибровка — отдельная переменная
  if (useCase === "calibration") {
    const fromEnv = parseInt(process.env.DIALOG_SOFT_CAP_CALIBRATION ?? "", 10);
    if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
    return informationAxes.calibration?.soft_cap ?? 1;
  }

  // 2. Daily dialog — по тарифу
  if (useCase === "daily_dialog") {
    const envKey = `DIALOG_SOFT_CAP_DAILY_${tier.toUpperCase()}`;
    const fromEnv = parseInt(process.env[envKey] ?? "", 10);
    if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
    return informationAxes.daily_dialog?.soft_cap ?? 6;
  }

  // 3. Дефолт для будущих сценариев
  return 6;
}
