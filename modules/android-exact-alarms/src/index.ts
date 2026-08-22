import { requireOptionalNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

type AndroidExactAlarmsNative = {
  canScheduleExactAlarms?(): Promise<boolean>;
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
