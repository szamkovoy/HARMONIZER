import {
  canScheduleExactAlarmsNative,
  getRestrictiveManufacturerKeyNative,
  isIgnoringBatteryOptimizationsNative,
  openBatteryOptimizationRequestNative,
  openManufacturerBackgroundSettingsNative,
} from "harmonizer-android-exact-alarms";
import { applicationId } from "expo-application";
import * as IntentLauncher from "expo-intent-launcher";
import { Alert, AppState, Linking, PermissionsAndroid, Platform } from "react-native";

/** Android 12 (API 31) — с этой версии exact alarms требуют отдельного разрешения. */
const ANDROID_EXACT_ALARM_API = 31;

/** Android 6 (API 23) — с этой версии Doze / battery optimization. */
const ANDROID_BATTERY_OPTIMIZATION_API = 23;

const SCHEDULE_EXACT_ALARM = "android.permission.SCHEDULE_EXACT_ALARM";

const SETTINGS_RECHECK_DELAYS_MS = [0, 150, 300, 600, 1200] as const;

type AlertCopy = {
  title: string;
  message: string;
  openSettingsLabel: string;
  cancelLabel: string;
};

/**
 * Без `AlarmManager.canScheduleExactAlarms()` expo-notifications молча ставит
 * inexact `setAndAllowWhileIdle` → Doze может сдвинуть срабатывание на десятки минут/час.
 */
export async function canScheduleAndroidExactAlarms(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  if (typeof Platform.Version === "number" && Platform.Version < ANDROID_EXACT_ALARM_API) {
    return true;
  }

  const native = await canScheduleExactAlarmsNative();
  if (native != null) return native;

  try {
    return await PermissionsAndroid.check(SCHEDULE_EXACT_ALARM);
  } catch {
    return false;
  }
}

/** `true` = приложение в whitelist оптимизации батареи (желательно для точных напоминаний). */
export async function isAndroidIgnoringBatteryOptimizations(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  if (typeof Platform.Version === "number" && Platform.Version < ANDROID_BATTERY_OPTIMIZATION_API) {
    return true;
  }

  const native = await isIgnoringBatteryOptimizationsNative();
  if (native != null) return native;

  // Старый dev-client без native-модуля — не блокируем schedule.
  return true;
}

export async function openAndroidExactAlarmSettings(): Promise<void> {
  if (Platform.OS !== "android") return;
  const pkg = applicationId?.trim() || "com.zamkovoi.harmonizer";
  try {
    await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.REQUEST_SCHEDULE_EXACT_ALARM, {
      data: `package:${pkg}`,
    });
    return;
  } catch {
    /* старый native binary без expo-intent-launcher — ниже fallback */
  }
  try {
    await Linking.openSettings();
  } catch {
    /* ignore */
  }
}

export async function openAndroidBatteryOptimizationSettings(): Promise<void> {
  if (Platform.OS !== "android") return;
  const opened = await openBatteryOptimizationRequestNative();
  if (opened) return;
  try {
    await Linking.openSettings();
  } catch {
    /* ignore */
  }
}

export async function openAndroidManufacturerBackgroundSettings(): Promise<void> {
  if (Platform.OS !== "android") return;
  const opened = await openManufacturerBackgroundSettingsNative();
  if (opened) return;
  try {
    await Linking.openSettings();
  } catch {
    /* ignore */
  }
}

function waitUntilReturnFromSettings(timeoutMs = 5 * 60_000): Promise<void> {
  return new Promise((resolve) => {
    let sawNonActive = AppState.currentState !== "active";
    const finish = () => {
      sub.remove();
      clearTimeout(timer);
      resolve();
    };
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") {
        sawNonActive = true;
        return;
      }
      if (sawNonActive) finish();
    });
    const timer = setTimeout(finish, timeoutMs);
  });
}

async function recheckAfterSettings(check: () => Promise<boolean>): Promise<boolean> {
  for (const delayMs of SETTINGS_RECHECK_DELAYS_MS) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (await check()) return true;
  }
  return false;
}

async function promptOpenSettings(copy: AlertCopy): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    Alert.alert(copy.title, copy.message, [
      { text: copy.cancelLabel, style: "cancel", onPress: () => resolve(false) },
      { text: copy.openSettingsLabel, onPress: () => resolve(true) },
    ]);
  });
}

async function ensureExactAlarms(copy: AlertCopy): Promise<boolean> {
  if (await canScheduleAndroidExactAlarms()) return true;
  if (!(await promptOpenSettings(copy))) return false;
  await openAndroidExactAlarmSettings();
  await waitUntilReturnFromSettings();
  return recheckAfterSettings(canScheduleAndroidExactAlarms);
}

async function ensureBatteryOptimization(copy: AlertCopy): Promise<boolean> {
  if (await isAndroidIgnoringBatteryOptimizations()) return true;
  if (!(await promptOpenSettings(copy))) return false;
  await openAndroidBatteryOptimizationSettings();
  await waitUntilReturnFromSettings();
  return recheckAfterSettings(isAndroidIgnoringBatteryOptimizations);
}

async function ensureManufacturerBackground(copy: AlertCopy): Promise<boolean> {
  const key = await getRestrictiveManufacturerKeyNative();
  if (!key) return true;
  if (!(await promptOpenSettings(copy))) return false;
  await openAndroidManufacturerBackgroundSettings();
  await waitUntilReturnFromSettings();
  // OEM autostart нельзя проверить через API — после визита в настройки продолжаем.
  return true;
}

/**
 * Перед DATE-триггером окна возможностей на Android:
 * 1) exact alarm (API 31+),
 * 2) исключение из battery optimization (API 23+),
 * 3) на Xiaomi/Huawei/Oppo/Vivo/OnePlus/Meizu — экран автозапуска / фона.
 */
export async function ensureAndroidOpportunityReminderPrerequisites(opts: {
  exactAlarm: AlertCopy;
  battery: AlertCopy;
  oemBackground: AlertCopy;
}): Promise<boolean> {
  if (Platform.OS !== "android") return true;

  if (!(await ensureExactAlarms(opts.exactAlarm))) return false;
  if (!(await ensureBatteryOptimization(opts.battery))) return false;
  if (!(await ensureManufacturerBackground(opts.oemBackground))) return false;
  return true;
}

/** @deprecated Используйте `ensureAndroidOpportunityReminderPrerequisites`. */
export async function ensureAndroidExactAlarmsForOpportunityReminders(opts: AlertCopy): Promise<boolean> {
  return ensureExactAlarms(opts);
}
