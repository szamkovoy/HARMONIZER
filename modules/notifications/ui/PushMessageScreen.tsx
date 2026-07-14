import { router, useLocalSearchParams, type Href } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { useAuth } from "@/modules/auth";
import { useTranslate } from "@/modules/i18n";
import { markNotificationRead } from "@/modules/notifications/core/notificationsClient";
import {
  consumePendingPushMessage,
  type PendingPushMessage,
} from "@/modules/notifications/core/pendingPushMessage";
import { LinkifiedBody } from "@/modules/posts/ui/LinkifiedBody";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { StackScreenLayout } from "@/modules/ui/StackScreenLayout";

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/**
 * Full push message reader opened from a notification tap.
 * Prefers in-memory pending payload; falls back to route params.
 * Back always returns to Home tabs (avoids half-booted stack after cold start).
 */
export function PushMessageScreen() {
  const { t } = useTranslate();
  const { authUser } = useAuth();
  const params = useLocalSearchParams<{ title?: string; body?: string; url?: string }>();
  const [message, setMessage] = useState<PendingPushMessage | null>(null);

  useEffect(() => {
    const pending = consumePendingPushMessage();
    if (pending) {
      setMessage(pending);
      return;
    }
    const title = firstParam(params.title).trim();
    const body = firstParam(params.body).trim();
    const url = firstParam(params.url).trim();
    if (title || body) {
      setMessage({
        notificationId: null,
        title: title || t("notifications.pushMessage.fallbackTitle"),
        body,
        url: url || null,
      });
    }
  }, [params.body, params.title, params.url, t]);

  useEffect(() => {
    const userId = authUser?.id;
    const notificationId = message?.notificationId;
    if (!userId || !notificationId) return;
    void markNotificationRead(userId, notificationId);
  }, [authUser?.id, message?.notificationId]);

  const linkUrl = useMemo(() => {
    if (message?.url) return message.url;
    return null;
  }, [message?.url]);

  return (
    <StackScreenLayout edges={["top", "left", "right", "bottom"]}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("posts.post.backA11y")}
          onPress={() => router.replace("/(tabs)" as Href)}
          hitSlop={12}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <AppText variant="screenTitle" tone="muted">
            ‹
          </AppText>
        </Pressable>
        <AppText variant="screenTitle" accessibilityRole="header" style={styles.headerTitle}>
          {t("notifications.pushMessage.screenTitle")}
        </AppText>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {!message ? (
          <AppText variant="screenHint" tone="muted">
            {t("notifications.pushMessage.missing")}
          </AppText>
        ) : (
          <>
            <AppText variant="screenTitle" accessibilityRole="header">
              {message.title}
            </AppText>
            {message.body ? <LinkifiedBody body={message.body} /> : null}
            {linkUrl ? (
              <AppButton
                label={t("notifications.openLink")}
                onPress={() => void Linking.openURL(linkUrl)}
              />
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => router.replace("/my-notifications" as Href)}
              style={({ pressed }) => ({ opacity: pressed ? 0.65 : 1, marginTop: 8 })}
            >
              <AppText variant="buttonLabel" tone="accent">
                {t("notifications.pushMessage.openInbox")}
              </AppText>
            </Pressable>
          </>
        )}
      </ScrollView>
    </StackScreenLayout>
  );
}

const styles = StyleSheet.create({
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 4,
  },
  headerTitle: {
    flex: 1,
  },
  content: {
    gap: 16,
    paddingHorizontal: 20,
    paddingBottom: 40,
    paddingTop: 8,
  },
});
