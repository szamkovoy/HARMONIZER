import { router } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, Linking, Pressable, StyleSheet, View } from "react-native";

import { useAuth } from "@/modules/auth";
import { formatRelativeTime, useTranslate } from "@/modules/i18n";
import {
  fetchMyNotifications,
  markAllNotificationsRead,
  type MyNotification,
} from "@/modules/notifications/core/notificationsClient";
import { AppText } from "@/modules/ui/AppText";
import { StackScreenLayout, useStackScreenContentProps } from "@/modules/ui/StackScreenLayout";
import { StateCard } from "@/modules/ui/StateCard";
import { useTheme } from "@/modules/ui/theme";

/** «Мои уведомления»: гарантированная витрина рассылок автора (не локальные колокольчики). */
export function MyNotificationsScreen() {
  const theme = useTheme();
  const { t, locale } = useTranslate();
  const { authUser, initializing } = useAuth();
  const userId = authUser?.id ?? null;
  const contentProps = useStackScreenContentProps({ topPadding: 4, gap: 10 });

  const [items, setItems] = useState<MyNotification[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (initializing) return;
    if (!userId) {
      setItems([]);
      setLoadError(null);
      return;
    }

    let cancelled = false;
    setItems(null);
    setLoadError(null);

    void fetchMyNotifications(userId, locale)
      .then((list) => {
        if (cancelled) return;
        setItems(list);
        // Открыл экран — непрочитанные видны с акцентом в этом рендере, затем помечаем прочитанными.
        if (list.some((item) => !item.readAt)) void markAllNotificationsRead(userId);
      })
      .catch(() => {
        if (cancelled) return;
        setItems([]);
        setLoadError(t("notifications.loadError"));
      });

    return () => {
      cancelled = true;
    };
  }, [initializing, locale, t, userId]);

  return (
    <StackScreenLayout edges={["top", "left", "right"]}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("posts.post.backA11y")}
          onPress={() => router.replace("/(tabs)/profile")}
          hitSlop={12}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <AppText variant="screenTitle" tone="muted">
            ‹
          </AppText>
        </Pressable>
        <AppText variant="screenTitle" accessibilityRole="header">
          {t("notifications.title")}
        </AppText>
      </View>

      <FlatList
        data={items ?? []}
        keyExtractor={(item) => item.notificationId}
        contentContainerStyle={contentProps.contentContainerStyle}
        scrollIndicatorInsets={contentProps.scrollIndicatorInsets}
        ListEmptyComponent={
          items === null ? (
            <StateCard loading message={t("notifications.loading")} />
          ) : loadError ? (
            <StateCard title={t("notifications.loadErrorTitle")} message={loadError} />
          ) : (
            <StateCard title={t("notifications.emptyTitle")} message={t("notifications.emptyMessage")} />
          )
        }
        renderItem={({ item }) => {
          const unread = !item.readAt;
          return (
            <View
              style={[
                styles.card,
                {
                  backgroundColor: unread
                    ? theme.colors.surfaceElevated
                    : theme.colors.surface,
                  borderColor: unread ? theme.colors.accent : theme.colors.surfaceBorder,
                  opacity: unread ? 1 : 0.72,
                },
              ]}
            >
              <View style={styles.cardHeader}>
                {unread ? <View style={[styles.unreadDot, { backgroundColor: theme.colors.accent }]} /> : null}
                <AppText variant="buttonLabel" tone={unread ? "primary" : "muted"} style={styles.cardTitle}>
                  {item.title}
                </AppText>
                <AppText variant="technicalCaption" tone="faint">
                  {formatRelativeTime(item.createdAt, locale)}
                </AppText>
              </View>
              {item.body ? (
                <AppText variant="screenHint" tone={unread ? "muted" : "faint"}>
                  {item.body}
                </AppText>
              ) : null}
              {item.linkUrl ? (
                <Pressable
                  accessibilityRole="link"
                  onPress={() => void Linking.openURL(item.linkUrl!)}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                >
                  <AppText variant="buttonLabel" tone="accent">
                    {t("notifications.openLink")}
                  </AppText>
                </Pressable>
              ) : null}
            </View>
          );
        }}
      />
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
  card: {
    borderRadius: 16,
    borderWidth: 1,
    gap: 8,
    padding: 14,
  },
  cardHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  cardTitle: {
    flex: 1,
  },
  unreadDot: {
    borderRadius: 999,
    height: 8,
    width: 8,
  },
});
