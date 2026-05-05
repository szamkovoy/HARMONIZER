import { Platform } from "react-native";

/** Канал Android для напоминаний по графику «окна возможностей». */
export const OPPORTUNITY_REMINDERS_CHANNEL_ID = "opportunity_reminders";

type ExpoNotificationsModule = typeof import("expo-notifications");

/** undefined = ещё не пробовали загрузить; null = недоступен; иначе модуль. */
let notificationsModule: ExpoNotificationsModule | null | undefined;

function loadExpoNotificationsModule(): ExpoNotificationsModule | null {
  if (notificationsModule !== undefined) return notificationsModule;
  if (Platform.OS === "web") {
    notificationsModule = null;
    return null;
  }
  try {
    notificationsModule = require("expo-notifications") as ExpoNotificationsModule;
    return notificationsModule;
  } catch {
    notificationsModule = null;
    return null;
  }
}

let configured = false;

/**
 * Один раз при старте приложения: показ в foreground, канал Android.
 * Без нативного модуля — no-op, чтобы не ронять бандл на старых dev client.
 */
export function configureLocalNotifications(): void {
  if (configured || Platform.OS === "web") return;
  const Notifications = loadExpoNotificationsModule();
  if (!Notifications) return;
  configured = true;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  if (Platform.OS === "android") {
    void Notifications.setNotificationChannelAsync(OPPORTUNITY_REMINDERS_CHANNEL_ID, {
      name: "Окна возможностей",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 100, 200],
      enableVibrate: true,
      sound: "default",
    });
  }
}

/**
 * Загружает `expo-notifications` при первом вызове.
 * На старых сборках без нативного слоя — `null` без падения всего бандла.
 */
export function getExpoNotificationsOrNull(): ExpoNotificationsModule | null {
  return loadExpoNotificationsModule();
}
