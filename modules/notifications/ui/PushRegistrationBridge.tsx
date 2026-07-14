import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { router, type Href } from "expo-router";

import { useAuth } from "@/modules/auth";
import { logAppOpen } from "@/modules/metrics/core/appOpen";
import { setPendingPushMessage } from "@/modules/notifications/core/pendingPushMessage";
import { registerPushToken } from "@/modules/notifications/core/pushRegistration";
import { getExpoNotificationsOrNull } from "@/services/localNotifications";

function asDataRecord(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") return {};
  return data as Record<string, unknown>;
}

function openPushMessage(response: {
  notification: {
    request: {
      content: {
        title?: string | null;
        body?: string | null;
        data?: unknown;
      };
    };
  };
}) {
  const content = response.notification.request.content;
  const data = asDataRecord(content.data);
  const title =
    (typeof data.title === "string" && data.title.trim()) ||
    (typeof content.title === "string" ? content.title : "") ||
    "";
  const body =
    (typeof data.body === "string" && data.body) ||
    (typeof content.body === "string" ? content.body : "") ||
    "";
  const url = typeof data.url === "string" && data.url.trim() ? data.url.trim() : null;
  const notificationId =
    typeof data.notificationId === "string" && data.notificationId.trim()
      ? data.notificationId.trim()
      : null;

  setPendingPushMessage({ notificationId, title, body, url });
  // replace: cold start must not leave a half-booted (tabs) under the reader
  // (back would flash empty Home + re-show splash).
  router.replace("/push-message" as Href);
}

/**
 * Registers push token, syncs locale, and opens the in-app message reader
 * when the user taps a remote notification (including cold start).
 */
export function PushRegistrationBridge() {
  const { authUser } = useAuth();
  const userId = authUser?.id ?? null;
  const registeredForRef = useRef<string | null>(null);
  const handledResponseIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || registeredForRef.current === userId) return;
    registeredForRef.current = userId;
    void registerPushToken(userId);
    void logAppOpen(userId);
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void logAppOpen(userId);
        void registerPushToken(userId);
      }
    });
    return () => subscription.remove();
  }, [userId]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const Notifications = getExpoNotificationsOrNull();
    if (!Notifications) return;

    const handle = (response: {
      notification: {
        request: { identifier?: string; content: { title?: string | null; body?: string | null; data?: unknown } };
      };
    }) => {
      const id = response.notification.request.identifier ?? JSON.stringify(response.notification.request.content);
      if (handledResponseIdRef.current === id) return;
      handledResponseIdRef.current = id;
      openPushMessage(response);
    };

    const subscription = Notifications.addNotificationResponseReceivedListener(handle);

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      handle(response);
      try {
        void Notifications.clearLastNotificationResponseAsync();
      } catch {
        /* older native builds */
      }
    });

    return () => subscription.remove();
  }, []);

  return null;
}
