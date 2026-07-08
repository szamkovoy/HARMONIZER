import { useEffect, useRef } from "react";
import { AppState, Linking, Platform } from "react-native";

import { useAuth } from "@/modules/auth";
import { logAppOpen } from "@/modules/metrics/core/appOpen";
import { registerPushToken } from "@/modules/notifications/core/pushRegistration";
import { getExpoNotificationsOrNull } from "@/services/localNotifications";

/**
 * Невидимый мост в корне приложения: регистрирует push-токен после логина,
 * логирует app_open (метрики активности) и открывает ссылку из data.url
 * при тапе по push-уведомлению.
 */
export function PushRegistrationBridge() {
  const { authUser } = useAuth();
  const userId = authUser?.id ?? null;
  const registeredForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || registeredForRef.current === userId) return;
    registeredForRef.current = userId;
    void registerPushToken(userId);
    void logAppOpen(userId);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void logAppOpen(userId);
    });
    return () => subscription.remove();
  }, [userId]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const Notifications = getExpoNotificationsOrNull();
    if (!Notifications) return;
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const url = response.notification.request.content.data?.url;
      if (typeof url === "string" && url) void Linking.openURL(url);
    });
    return () => subscription.remove();
  }, []);

  return null;
}
