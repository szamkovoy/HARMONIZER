import { useFocusEffect } from "@react-navigation/native";
import { router, type Href } from "expo-router";
import { DateTime } from "luxon";
import { useCallback, useState } from "react";
import { FlatList, Image, Pressable, RefreshControl, StyleSheet, View } from "react-native";

import { useTranslate } from "@/modules/i18n";
import {
  fetchPostsFeedForLocale,
  resolvePostContentForLocale,
  type PostItem,
} from "@/modules/posts/core/postsClient";
import { AppText } from "@/modules/ui/AppText";
import { ScreenHeader } from "@/modules/ui/ScreenHeader";
import { StateCard } from "@/modules/ui/StateCard";
import { SurfaceCardHelpButton } from "@/modules/ui/SurfaceCardHelpButton";
import { SurfaceHelpModal } from "@/modules/ui/SurfaceHelpModal";
import { TabScreenLayout, useTabScreenContentProps } from "@/modules/ui/TabScreenLayout";
import { useTheme } from "@/modules/ui/theme";
import { WebinarsStrip } from "@/modules/webinars";

export function PostsFeedScreen() {
  const theme = useTheme();
  const { t, locale } = useTranslate();
  const listContentProps = useTabScreenContentProps({ bottomPaddingExtra: 20 });

  const [posts, setPosts] = useState<PostItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [helpVisible, setHelpVisible] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    void fetchPostsFeedForLocale(locale).then((items) => {
      if (!cancelled) setPosts(items);
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  useFocusEffect(load);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setPosts(await fetchPostsFeedForLocale(locale));
    } finally {
      setRefreshing(false);
    }
  }, [locale]);

  return (
    <TabScreenLayout>
      <FlatList
        data={posts ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={listContentProps.contentContainerStyle}
        scrollIndicatorInsets={listContentProps.scrollIndicatorInsets}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={theme.colors.textMuted} />
        }
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <ScreenHeader
              title={t("posts.feed.title")}
              subtitle={t("posts.feed.subtitle")}
              trailing={
                <SurfaceCardHelpButton
                  accessibilityLabel={t("posts.feed.helpA11y")}
                  onPress={() => setHelpVisible(true)}
                />
              }
            />
            <WebinarsStrip />
          </View>
        }
        ListEmptyComponent={
          posts === null ? (
            <StateCard loading message={t("posts.feed.loading")} />
          ) : (
            <StateCard title={t("posts.feed.emptyTitle")} message={t("posts.feed.emptyMessage")} />
          )
        }
        renderItem={({ item }) => {
          const content = resolvePostContentForLocale(item, locale);
          if (!content) return null;
          const dateLabel = item.publishedAt
            ? DateTime.fromISO(item.publishedAt).setLocale(locale).toLocaleString(DateTime.DATE_MED)
            : "";
          return (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/post/${item.id}` as Href)}
              style={({ pressed }) => [
                styles.card,
                {
                  backgroundColor: theme.colors.surfaceElevated,
                  borderColor: theme.colors.surfaceBorder,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              {content.coverUrl ? <Image source={{ uri: content.coverUrl }} style={styles.cover} resizeMode="cover" /> : null}
              <View style={styles.cardBody}>
                <AppText variant="sectionTitle">{content.title}</AppText>
                <AppText variant="technicalCaption" tone="faint">
                  {dateLabel}
                  {dateLabel ? "  ·  " : ""}
                  {t("posts.comments.countLabel", { count: item.commentCount })}
                </AppText>
              </View>
            </Pressable>
          );
        }}
      />
      <SurfaceHelpModal
        visible={helpVisible}
        title={t("posts.feed.helpTitle")}
        closeLabel={t("common.close")}
        onClose={() => setHelpVisible(false)}
        body={t("posts.feed.helpBody")}
      />
    </TabScreenLayout>
  );
}

const styles = StyleSheet.create({
  listHeader: {
    gap: 18,
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
  },
  cover: {
    aspectRatio: 16 / 9,
    width: "100%",
  },
  cardBody: {
    gap: 6,
    padding: 14,
  },
});
