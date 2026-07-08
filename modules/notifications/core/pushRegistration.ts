import Constants from "expo-constants";
import { Platform } from "react-native";

import { getExpoNotificationsOrNull } from "@/services/localNotifications";
import { getSupabase } from "@/services/supabase";

/**
 * Регистрирует Expo push-токен устройства в push_tokens (upsert по token).
 * Молча выходит, если разрешение не выдано или нативный модуль недоступен —
 * гарантированная доставка идёт через «Мои уведомления», push лишь дублирует.
 */
export async function registerPushToken(userId: string): Promise<void> {
  if (Platform.OS === "web") return;
  const Notifications = getExpoNotificationsOrNull();
  const supabase = getSupabase();
  if (!Notifications || !supabase) return;

  try {
    let { status } = await Notifications.getPermissionsAsync();
    if (status === "undetermined") {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== "granted") return;

    const projectId: string | undefined =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) {
      if (__DEV__) console.warn("[notifications] EAS projectId not found, push disabled");
      return;
    }

    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!data) return;

    const { error } = await supabase.from("push_tokens").upsert(
      {
        user_id: userId,
        token: data,
        platform: Platform.OS === "ios" ? "ios" : "android",
        expo_token: true,
        is_active: true,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "token" },
    );
    if (error && __DEV__) console.warn("[notifications] token upsert failed", error.message);
  } catch (error) {
    if (__DEV__) console.warn("[notifications] push registration failed", error);
  }
}
