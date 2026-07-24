import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { router, type Href } from "expo-router";

import { useAuth } from "@/modules/auth";
import { logAppOpen } from "@/modules/metrics/core/appOpen";
import { setPendingPushMessage } from "@/modules/notifications/core/pendingPushMessage";
import { recordInboxNotification } from "@/modules/notifications/core/recordInboxNotification";
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

async function maybeRecordOpportunityFromContent(content: {
  title?: string | null;
  body?: string | null;
  data?: unknown;
}): Promise<void> {
  const data = asDataRecord(content.data);
  if (data.source !== "home_opportunity_window") return;
  const key = typeof data.key === "string" ? data.key : "";
  const forecastDate = typeof data.forecastDate === "string" ? data.forecastDate : "";
  const reminderMode = typeof data.reminderMode === "string" ? data.reminderMode : "";
  if (!key || !forecastDate) return;
  const title =
    (typeof data.displayTitle === "string" && data.displayTitle.trim()) ||
    (typeof content.title === "string" ? content.title.trim() : "") ||
    "";
  const body = typeof content.body === "string" ? content.body : "";
  if (!title) return;
  await recordInboxNotification({
    kind: "opportunity",
    title,
    body,
    sourceKey: `opportunity:${key}:${forecastDate}:${reminderMode || "exact"}`,
  });
}

/**
 * Registers push token (только если разрешение уже выдано — без системного
 * диалога; запросы делает `ensureNotificationPermission` на Home / bell / webinar),
 * syncs locale, records opportunity firings into inbox, and opens the in-app
 * message reader on notification tap.
 */
export function PushRegistrationBridge() {
  const { authUser } = useAuth();
  const userId = authUser?.id ?? null;
  const registeredForRef = useRef<string | null>(null);
  const handledResponseIdRef = useRef<string | null>(null);
  const recordedOpportunityRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!userId || registeredForRef.current === userId) return;
    registeredForRef.current = userId;
    // Без prompt: токен только при уже granted (после Home/bell/webinar).
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
    if (Platform.OS === "web" || !userId) return;
    const Notifications = getExpoNotificationsOrNull();
    if (!Notifications) return;

    const recordOnce = (content: {
      title?: string | null;
      body?: string | null;
      data?: unknown;
    }) => {
      const data = asDataRecord(content.data);
      if (data.source !== "home_opportunity_window") return;
      const key = typeof data.key === "string" ? data.key : "";
      const forecastDate = typeof data.forecastDate === "string" ? data.forecastDate : "";
      const reminderMode = typeof data.reminderMode === "string" ? data.reminderMode : "exact";
      const dedupe = `${key}:${forecastDate}:${reminderMode}`;
      if (!key || recordedOpportunityRef.current.has(dedupe)) return;
      recordedOpportunityRef.current.add(dedupe);
      void maybeRecordOpportunityFromContent(content);
    };

    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      recordOnce(notification.request.content);
    });

    const handleResponse = (response: {
      notification: {
        request: { identifier?: string; content: { title?: string | null; body?: string | null; data?: unknown } };
      };
    }) => {
      recordOnce(response.notification.request.content);
      const id = response.notification.request.identifier ?? JSON.stringify(response.notification.request.content);
      if (handledResponseIdRef.current === id) return;
      handledResponseIdRef.current = id;
      openPushMessage(response);
    };

    const responseSub = Notifications.addNotificationResponseReceivedListener(handleResponse);

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      handleResponse(response);
      try {
        void Notifications.clearLastNotificationResponseAsync();
      } catch {
        /* older native builds */
      }
    });

    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, [userId]);

  return null;
}
