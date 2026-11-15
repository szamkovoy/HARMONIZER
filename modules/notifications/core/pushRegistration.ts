import Constants from "expo-constants";
import { Platform } from "react-native";

import { getAppLocale } from "@/modules/i18n/localeStore";
import { getExpoNotificationsOrNull } from "@/services/localNotifications";
import { getSupabase } from "@/services/supabase";
import { syncUserLocaleToServer } from "@/services/userLocaleClient";

import { hasNotificationPermission } from "./notificationPermissionPolicy";
import { readNotifFlag, writeNotifFlag } from "./notificationPermissionStore";

export type PushRegistrationStage =
  | "no_permission"
  | "no_project_id"
  | "token_error"
  | "claim_error"
  | "claimed";

/** One event per stage per process; same stage at most once per UTC day on device. */
const loggedStagesThisLaunch = new Set<PushRegistrationStage>();

function utcDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function logPushRegistrationEvent(params: {
  userId: string;
  stage: PushRegistrationStage;
  message?: string;
}): Promise<void> {
  const platform = Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : Platform.OS;
  if (platform !== "ios" && platform !== "android") return;
  if (loggedStagesThisLaunch.has(params.stage)) return;

  const dayFlag = `push.reg.${params.stage}.${utcDayKey()}`;
  try {
    const alreadyToday = await readNotifFlag(dayFlag);
    if (alreadyToday === "1") {
      loggedStagesThisLaunch.add(params.stage);
      return;
    }
  } catch {
    // Still try to insert once this launch.
  }

  loggedStagesThisLaunch.add(params.stage);
  try {
    await writeNotifFlag(dayFlag, "1");
  } catch {
    // Non-fatal.
  }

  const supabase = getSupabase();
  if (!supabase) return;
  try {
    const { error } = await supabase.from("user_event_log").insert({
      user_id: params.userId,
      kind: "push_registration",
      payload: {
        platform,
        stage: params.stage,
        ...(params.message ? { message: params.message.slice(0, 500) } : {}),
      },
    });
    if (error) {
      console.warn("[notifications] push_registration event failed", error.message);
    }
  } catch (error) {
    console.warn("[notifications] push_registration event failed", error);
  }
}

/**
 * Registers Expo push token via claim_push_token RPC (security definer) so the
 * device token is always owned by the signed-in user — plain upsert is blocked
 * by RLS when the token was previously tied to another account.
 * Also mirrors UI locale → users.locale (language for remote pushes).
 *
 * Does NOT prompt for permission — use `ensureNotificationPermission` first.
 */
export async function registerPushToken(userId: string): Promise<void> {
  if (Platform.OS === "web") return;
  const Notifications = getExpoNotificationsOrNull();
  const supabase = getSupabase();
  if (!Notifications || !supabase) return;

  const platform = Platform.OS === "ios" ? "ios" : "android";

  try {
    // Await so remote push language matches UI before Expo claim (avoids RU push / EN inbox).
    try {
      await syncUserLocaleToServer(getAppLocale());
    } catch {
      // Non-fatal — token claim still proceeds.
    }

    const allowed = await hasNotificationPermission();
    if (!allowed) {
      console.warn("[notifications] hasNotificationPermission=false", { platform });
      await logPushRegistrationEvent({ userId, stage: "no_permission" });
      return;
    }

    const projectId: string | undefined =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) {
      console.warn("[notifications] EAS projectId not found, push disabled");
      await logPushRegistrationEvent({ userId, stage: "no_project_id" });
      return;
    }

    let data: string | undefined;
    try {
      const token = await Notifications.getExpoPushTokenAsync({ projectId });
      data = token.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[notifications] getExpoPushTokenAsync failed", message);
      await logPushRegistrationEvent({ userId, stage: "token_error", message });
      return;
    }
    if (!data) {
      console.warn("[notifications] getExpoPushTokenAsync returned empty token");
      await logPushRegistrationEvent({
        userId,
        stage: "token_error",
        message: "empty_token",
      });
      return;
    }

    const { error } = await supabase.rpc("claim_push_token", {
      p_token: data,
      p_platform: platform,
      p_expo_token: true,
    });
    if (error) {
      console.warn("[notifications] claim_push_token failed", error.message);
      await logPushRegistrationEvent({
        userId,
        stage: "claim_error",
        message: error.message,
      });
      return;
    }
    console.warn("[notifications] push token claimed", { userId, platform });
    await logPushRegistrationEvent({ userId, stage: "claimed" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Android remote push needs FCM in the native build; without it getExpoPushTokenAsync fails.
    if (
      Platform.OS === "android" &&
      /firebase|fcm|google.?services|Default FirebaseApp/i.test(message)
    ) {
      console.warn(
        "[notifications] Android Expo push token unavailable — configure FCM (google-services.json + EAS credentials)",
        message,
      );
      await logPushRegistrationEvent({ userId, stage: "token_error", message });
      return;
    }
    console.warn("[notifications] push registration failed", error);
    await logPushRegistrationEvent({ userId, stage: "token_error", message });
  }
}
