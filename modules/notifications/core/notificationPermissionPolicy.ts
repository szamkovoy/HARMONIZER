/**
 * Единая политика запроса разрешения на уведомления.
 *
 * Причины:
 *   - home — мягкий запрос при фокусе Главной (undetermined; после отказа — пауза 7 дн.)
 *   - opportunity_bell — явный жест (колокольчик): всегда пытаемся, без cooldown
 *   - webinar — запись / экран «вы записаны»: повтор не чаще раз в 3 дня
 *
 * PushRegistrationBridge только регистрирует токен, если уже granted — не спрашивает.
 */
import { Platform } from "react-native";

import { getExpoNotificationsOrNull } from "@/services/localNotifications";

import { readNotifFlag, writeNotifFlag } from "./notificationPermissionStore";

export type NotificationPermissionReason = "home" | "opportunity_bell" | "webinar";

export type NotificationPermissionResult = "granted" | "denied" | "skipped" | "unavailable";

const SOFT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const WEBINAR_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;

const FLAG_LAST_SOFT_ASK = "perm.lastSoftAskAt";
const FLAG_LAST_WEBINAR_ASK = "perm.lastWebinarAskAt";

type PermSnapshot = {
  granted: boolean;
  status: string;
  canAskAgain: boolean;
};

async function readPermissions(): Promise<PermSnapshot | null> {
  const Notifications = getExpoNotificationsOrNull();
  if (!Notifications) return null;
  try {
    const current = await Notifications.getPermissionsAsync();
    const iosOk =
      current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL ||
      current.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED;
    const granted = Boolean(current.granted || iosOk);
    return {
      granted,
      status: String(current.status ?? ""),
      canAskAgain: current.canAskAgain !== false,
    };
  } catch {
    return null;
  }
}

async function requestFromOs(): Promise<PermSnapshot | null> {
  const Notifications = getExpoNotificationsOrNull();
  if (!Notifications) return null;
  try {
    const next = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    });
    const iosOk =
      next.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL ||
      next.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED;
    return {
      granted: Boolean(next.granted || iosOk),
      status: String(next.status ?? ""),
      canAskAgain: next.canAskAgain !== false,
    };
  } catch {
    return null;
  }
}

async function readTs(flag: string): Promise<number> {
  const raw = await readNotifFlag(flag);
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Запросить разрешение по политике причины.
 * Возвращает `skipped`, если cooldown / уже нельзя спрашивать у ОС.
 */
export async function ensureNotificationPermission(
  reason: NotificationPermissionReason,
): Promise<NotificationPermissionResult> {
  if (Platform.OS === "web") return "unavailable";

  const before = await readPermissions();
  if (!before) return "unavailable";
  if (before.granted) return "granted";

  const now = Date.now();

  if (reason === "home") {
    // Мягкий: только пока ОС ещё не решила, либо canAskAgain после паузы.
    if (before.status === "undetermined") {
      const lastSoft = await readTs(FLAG_LAST_SOFT_ASK);
      if (lastSoft > 0 && now - lastSoft < SOFT_COOLDOWN_MS) return "skipped";
    } else {
      // denied (или иное): повтор только если ОС разрешает и прошла пауза
      if (!before.canAskAgain) return "skipped";
      const lastSoft = await readTs(FLAG_LAST_SOFT_ASK);
      if (lastSoft > 0 && now - lastSoft < SOFT_COOLDOWN_MS) return "skipped";
    }
    await writeNotifFlag(FLAG_LAST_SOFT_ASK, String(now));
    const after = await requestFromOs();
    if (!after) return "unavailable";
    return after.granted ? "granted" : "denied";
  }

  if (reason === "webinar") {
    if (!before.canAskAgain && before.status !== "undetermined") return "skipped";
    const last = await readTs(FLAG_LAST_WEBINAR_ASK);
    if (last > 0 && now - last < WEBINAR_COOLDOWN_MS) return "skipped";
    await writeNotifFlag(FLAG_LAST_WEBINAR_ASK, String(now));
    // Считаем и soft-ask, чтобы Home не дублировал сразу после вебинара.
    await writeNotifFlag(FLAG_LAST_SOFT_ASK, String(now));
    const after = await requestFromOs();
    if (!after) return "unavailable";
    return after.granted ? "granted" : "denied";
  }

  // opportunity_bell — явный жест: без cooldown.
  // Если ОС больше не показывает системный диалог — сразу denied (UI → Settings).
  if (!before.canAskAgain && before.status !== "undetermined") return "denied";
  await writeNotifFlag(FLAG_LAST_SOFT_ASK, String(now));
  const after = await requestFromOs();
  if (!after) return "unavailable";
  return after.granted ? "granted" : "denied";
}

/** Уже выдано ли разрешение (без запроса). */
export async function hasNotificationPermission(): Promise<boolean> {
  const snap = await readPermissions();
  return snap?.granted ?? false;
}
