import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

type AndroidExactAlarmsNative = {
  canScheduleExactAlarms?(): Promise<boolean>;
  isIgnoringBatteryOptimizations?(): Promise<boolean>;
  openBatteryOptimizationRequest?(): Promise<boolean>;
  getRestrictiveManufacturerKey?(): Promise<string | null>;
  openManufacturerBackgroundSettings?(): Promise<boolean>;
};

const nativeModule = requireOptionalNativeModule<AndroidExactAlarmsNative>("AndroidExactAlarms");

/**
 * Authoritative Android 12+ exact-alarm grant check.
 * Returns `null` when the native module is missing (old dev client / Expo Go).
 */
export async function canScheduleExactAlarmsNative(): Promise<boolean | null> {
  if (Platform.OS !== "android") return true;
  if (!nativeModule?.canScheduleExactAlarms) return null;
  try {
    return await nativeModule.canScheduleExactAlarms();
  } catch {
    return null;
  }
}

/** `true` = app is exempt from Doze battery optimizations (desired for on-time reminders). */
export async function isIgnoringBatteryOptimizationsNative(): Promise<boolean | null> {
  if (Platform.OS !== "android") return true;
  if (!nativeModule?.isIgnoringBatteryOptimizations) return null;
  try {
    return await nativeModule.isIgnoringBatteryOptimizations();
  } catch {
    return null;
  }
}

export async function openBatteryOptimizationRequestNative(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  if (!nativeModule?.openBatteryOptimizationRequest) return false;
  try {
    return await nativeModule.openBatteryOptimizationRequest();
  } catch {
    return false;
  }
}

/** Xiaomi / Huawei / Oppo / Vivo / OnePlus / Meizu — extra background settings may be required. */
export async function getRestrictiveManufacturerKeyNative(): Promise<string | null> {
  if (Platform.OS !== "android") return null;
  if (!nativeModule?.getRestrictiveManufacturerKey) return null;
  try {
    const key = await nativeModule.getRestrictiveManufacturerKey();
    return typeof key === "string" && key.trim() ? key.trim() : null;
  } catch {
    return null;
  }
}

export async function openManufacturerBackgroundSettingsNative(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  if (!nativeModule?.openManufacturerBackgroundSettings) return false;
  try {
    return await nativeModule.openManufacturerBackgroundSettings();
  } catch {
    return false;
  }
}
