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

/** «Мои уведомления»: гарантированная витрина рассылок (работает и без push-разрешений). */
export function MyNotificationsScreen() {
  const theme = useTheme();
  const { t, locale } = useTranslate();
  const { authUser } = useAuth();
  const userId = authUser?.id ?? null;
  const contentProps = useStackScreenContentProps({ topPadding: 4, gap: 10 });

  const [items, setItems] = useState<MyNotification[] | null>(null);

  useEffect(() => {
    if (!userId) return;
    void fetchMyNotifications(userId, locale).then((list) => {
      setItems(list);
      // Открыл экран — всё считаем прочитанным; непрочитанные подсвечены в этом рендере.
      if (list.some((item) => !item.readAt)) void markAllNotificationsRead(userId);
    });
  }, [userId, locale]);

  return (
    <StackScreenLayout edges={["top", "left", "right"]}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("posts.post.backA11y")}
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/profile"))}
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
          ) : (
            <StateCard title={t("notifications.emptyTitle")} message={t("notifications.emptyMessage")} />
          )
        }
        renderItem={({ item }) => (
          <View
            style={[
              styles.card,
              {
                backgroundColor: theme.colors.surfaceElevated,
                borderColor: item.readAt ? theme.colors.surfaceBorder : theme.colors.accent,
              },
            ]}
          >
            <View style={styles.cardHeader}>
              {!item.readAt ? <View style={[styles.unreadDot, { backgroundColor: theme.colors.accent }]} /> : null}
              <AppText variant="buttonLabel" style={styles.cardTitle}>
                {item.title}
              </AppText>
              <AppText variant="technicalCaption" tone="faint">
                {formatRelativeTime(item.createdAt, locale)}
              </AppText>
            </View>
            {item.body ? (
              <AppText variant="screenHint" tone="muted">
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
        )}
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
