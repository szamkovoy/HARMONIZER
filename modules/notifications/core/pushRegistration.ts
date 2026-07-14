import Constants from "expo-constants";
import { Platform } from "react-native";

import { getAppLocale } from "@/modules/i18n/localeStore";
import { getExpoNotificationsOrNull } from "@/services/localNotifications";
import { getSupabase } from "@/services/supabase";
import { syncUserLocaleToServer } from "@/services/userLocaleClient";

/**
 * Registers Expo push token via claim_push_token RPC (security definer) so the
 * device token is always owned by the signed-in user — plain upsert is blocked
 * by RLS when the token was previously tied to another account.
 * Also mirrors UI locale → users.locale (language for remote pushes).
 */
export async function registerPushToken(userId: string): Promise<void> {
  if (Platform.OS === "web") return;
  const Notifications = getExpoNotificationsOrNull();
  const supabase = getSupabase();
  if (!Notifications || !supabase) return;

  try {
    void syncUserLocaleToServer(getAppLocale()).catch(() => undefined);

    let { status } = await Notifications.getPermissionsAsync();
    if (status === "undetermined") {
      ({ status } = await Notifications.requestPermissionsAsync({
        ios: {
          allowAlert: true,
          allowBadge: true,
          allowSound: true,
        },
      }));
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

    const platform = Platform.OS === "ios" ? "ios" : "android";
    const { error } = await supabase.rpc("claim_push_token", {
      p_token: data,
      p_platform: platform,
      p_expo_token: true,
    });
    if (error) {
      // Always log — silent RLS upsert failures caused Russian pushes for IT profiles.
      console.warn("[notifications] claim_push_token failed", error.message);
      return;
    }
    if (__DEV__) {
      console.log("[notifications] push token claimed", { userId, platform });
    }
  } catch (error) {
    console.warn("[notifications] push registration failed", error);
  }
}
