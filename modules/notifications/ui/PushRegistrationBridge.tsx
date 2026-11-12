import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { router, type Href } from "expo-router";
import * as SecureStore from "expo-secure-store";

import { useAuth } from "@/modules/auth";
import { logAppOpen } from "@/modules/metrics/core/appOpen";
import { setPendingPushMessage } from "@/modules/notifications/core/pendingPushMessage";
import { recordInboxNotification } from "@/modules/notifications/core/recordInboxNotification";
import { registerPushToken } from "@/modules/notifications/core/pushRegistration";
import { getExpoNotificationsOrNull } from "@/services/localNotifications";

/**
 * expo-notifications on Android caches the last notification response in
 * native storage that survives a Play Store update (Android restores app
 * data backup). `getLastNotificationResponseAsync()` then returns that
 * stale response on every subsequent launch — including launches from the
 * Play Store «Open» button that did NOT come from a notification tap. The
 * in-session `handledResponseIdRef` resets every process restart, so it
 * cannot dedupe across restarts. Persisting the last handled id in SecureStore
 * (which also survives updates) lets us treat a repeated stale response as
 * "already handled" → clear the native cache and do NOT navigate.
 */
const HANDLED_RESPONSE_ID_KEY = "harmonizer.notifications.lastHandledResponseId";

async function readHandledResponseId(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(HANDLED_RESPONSE_ID_KEY);
  } catch {
    return null;
  }
}

async function writeHandledResponseId(id: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(HANDLED_RESPONSE_ID_KEY, id);
  } catch {
    // ignore — best-effort dedupe
  }
}

/**
 * Decide whether a `getLastNotificationResponseAsync()` result should open
 * the push reader. Returns `"fresh"` for a never-handled id (navigate +
 * persist), `"stale"` for an already-handled id (clear native cache, do NOT
 * navigate). Extracted so the dedupe can be unit-tested without mounting
 * the bridge.
 */
export async function classifyLastResponse(
  responseId: string,
  readHandled: () => Promise<string | null>,
): Promise<"fresh" | "stale"> {
  try {
    return (await readHandled()) === responseId ? "stale" : "fresh";
  } catch {
    return "fresh";
  }
}

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

  // Location OS prompt lives only in Home (`useDayContent` → promptForegroundLocationOnLaunch).
  // Firing it here raced Zero-Tap restore under splash and orphaned the permission sheet.
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
      void writeHandledResponseId(id);
      openPushMessage(response);
    };

    const responseSub = Notifications.addNotificationResponseReceivedListener(handleResponse);

    // Cold-start path: the app was launched by tapping a notification while
    // it was killed. On Android the same cached response is re-returned after
    // a Play Store update (data backup restore) even when the launch did NOT
    // come from a notification tap (e.g. Play Store «Open»). Dedupe against
    // SecureStore so a stale response from a previous session does not push
    // the user onto /push-message on every store launch.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const id =
        response.notification.request.identifier ??
        JSON.stringify(response.notification.request.content);
      void (async () => {
        const verdict = await classifyLastResponse(id, readHandledResponseId);
        if (verdict === "stale") {
          // Stale: already opened in a previous session. Clear native cache
          // and do not navigate — this launch was not from this notification.
          try {
            void Notifications.clearLastNotificationResponseAsync();
          } catch {
            /* older native builds */
          }
          return;
        }
        handledResponseIdRef.current = id;
        void writeHandledResponseId(id);
        handleResponse(response);
        try {
          void Notifications.clearLastNotificationResponseAsync();
        } catch {
          /* older native builds */
        }
      })();
    });

    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, [userId]);

  return null;
}
