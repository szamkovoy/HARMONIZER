import { canScheduleExactAlarmsNative } from "harmonizer-android-exact-alarms";
import { applicationId } from "expo-application";
import * as IntentLauncher from "expo-intent-launcher";
import { Alert, AppState, Linking, PermissionsAndroid, Platform } from "react-native";

/** Android 12 (API 31) — с этой версии exact alarms требуют отдельного разрешения. */
const ANDROID_EXACT_ALARM_API = 31;

const SCHEDULE_EXACT_ALARM = "android.permission.SCHEDULE_EXACT_ALARM";

const EXACT_ALARM_RECHECK_DELAYS_MS = [0, 150, 300, 600, 1200] as const;

/**
 * Без `AlarmManager.canScheduleExactAlarms()` expo-notifications молча ставит
 * inexact `setAndAllowWhileIdle` → Doze может сдвинуть срабатывание на десятки минут/час.
 * `PermissionsAndroid.check(SCHEDULE_EXACT_ALARM)` на API 31+ часто ложно возвращает false
 * даже при включённом «Будильники и напоминания» — используем native bridge.
 */
export async function canScheduleAndroidExactAlarms(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  if (typeof Platform.Version === "number" && Platform.Version < ANDROID_EXACT_ALARM_API) {
    return true;
  }

  const native = await canScheduleExactAlarmsNative();
  if (native != null) return native;

  // Fallback для старого dev-client без native-модуля.
  try {
    return await PermissionsAndroid.check(SCHEDULE_EXACT_ALARM);
  } catch {
    return false;
  }
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

async function recheckExactAlarmGrantAfterSettings(): Promise<boolean> {
  for (const delayMs of EXACT_ALARM_RECHECK_DELAYS_MS) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (await canScheduleAndroidExactAlarms()) return true;
  }
  return false;
}

/**
 * Перед DATE-триггером окна возможностей: без exact alarm на Android 12+
 * напоминание может прийти с большой задержкой.
 * Возвращает true только если exact доступен (или ОС ниже API 31).
 */
export async function ensureAndroidExactAlarmsForOpportunityReminders(opts: {
  title: string;
  message: string;
  openSettingsLabel: string;
  cancelLabel: string;
}): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  if (await canScheduleAndroidExactAlarms()) return true;

  const opened = await new Promise<boolean>((resolve) => {
    Alert.alert(opts.title, opts.message, [
      { text: opts.cancelLabel, style: "cancel", onPress: () => resolve(false) },
      {
        text: opts.openSettingsLabel,
        onPress: () => resolve(true),
      },
    ]);
  });

  if (!opened) return false;

  await openAndroidExactAlarmSettings();
  await waitUntilReturnFromSettings();
  return recheckExactAlarmGrantAfterSettings();
}
