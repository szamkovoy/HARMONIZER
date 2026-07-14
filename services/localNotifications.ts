import type { NotificationContentInput } from "expo-notifications";
import { Platform } from "react-native";

/**
 * Новый id канала: на Android после создания канала важность/звук почти не меняются —
 * новый id заставит систему применить «настойчивый» профиль.
 */
export const OPPORTUNITY_REMINDERS_CHANNEL_ID = "harmonizer_opportunity_high";

/** Remote admin / system pushes — must match Expo `channelId` in expoPush.ts. */
export const REMOTE_PUSH_CHANNEL_ID = "harmonizer_remote";

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
 * Один раз при старте приложения: показ в foreground, каналы Android.
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
      name: "Окна возможностей (напоминания)",
      description: "Заметные напоминания о времени окон возможностей.",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 400, 200, 400, 200, 400, 200, 400, 200, 800],
      enableVibrate: true,
      enableLights: true,
      lightColor: "#FFFF9800",
      sound: "default",
      audioAttributes: {
        usage: Notifications.AndroidAudioUsage.ALARM,
        contentType: Notifications.AndroidAudioContentType.SONIFICATION,
        flags: {
          enforceAudibility: true,
          requestHardwareAudioVideoSynchronization: false,
        },
      },
    });
    void Notifications.setNotificationChannelAsync(REMOTE_PUSH_CHANNEL_ID, {
      name: "Сообщения Harmonizer",
      description: "Рассылки и важные сообщения из приложения.",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 150, 250],
      enableVibrate: true,
      sound: "default",
    });
  }
}

/**
 * Контент локального уведомления: максимально заметно в рамках API (не отдельный «будильник»).
 * Android: приоритет max + длинная вибрация на самом уведомлении (дублирует канал).
 * iOS: timeSensitive — пробивает часть режимов «Фокус» при включённом entitlement в проекте.
 */
export function buildOpportunityAlarmStyleContent(base: {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}): NotificationContentInput {
  const out: NotificationContentInput = {
    title: base.title,
    body: base.body,
    data: base.data,
    sound: true,
  };
  if (Platform.OS === "ios") {
    out.interruptionLevel = "timeSensitive";
  }
  if (Platform.OS === "android") {
    out.priority = "max";
    out.vibrate = [0, 380, 180, 380, 180, 380, 180, 600];
  }
  return out;
}

/**
 * Загружает `expo-notifications` при первом вызове.
 * На старых сборках без нативного слоя — `null` без падения всего бандла.
 */
export function getExpoNotificationsOrNull(): ExpoNotificationsModule | null {
  return loadExpoNotificationsModule();
}
