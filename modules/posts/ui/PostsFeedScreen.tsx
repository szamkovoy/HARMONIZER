import { useFocusEffect } from "@react-navigation/native";
import { router, type Href } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from "react-native";

import { useTranslate } from "@/modules/i18n";
import {
  fetchPostsFeedForLocale,
  POSTS_FEED_PAGE_SIZE,
  type PostItem,
  type PostsFeedCursor,
} from "@/modules/posts/core/postsClient";
import { VideoCard } from "@/modules/posts/ui/VideoCard";
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
  const listContentProps = useTabScreenContentProps({ bottomPaddingExtra: 20, maxWidth: 460 });

  const [posts, setPosts] = useState<PostItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<PostsFeedCursor | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [helpVisible, setHelpVisible] = useState(false);
  const loadingMoreRef = useRef(false);
  const nextCursorRef = useRef<PostsFeedCursor | null>(null);

  const applyPage = useCallback((items: PostItem[], cursor: PostsFeedCursor | null, append: boolean) => {
    setPosts((prev) => {
      if (!append || prev == null) return items;
      const seen = new Set(prev.map((p) => p.id));
      return [...prev, ...items.filter((p) => !seen.has(p.id))];
    });
    nextCursorRef.current = cursor;
    setNextCursor(cursor);
  }, []);

  const loadFirstPage = useCallback(async () => {
    const page = await fetchPostsFeedForLocale(locale, POSTS_FEED_PAGE_SIZE);
    applyPage(page.items, page.nextCursor, false);
  }, [applyPage, locale]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void fetchPostsFeedForLocale(locale, POSTS_FEED_PAGE_SIZE).then((page) => {
        if (cancelled) return;
        applyPage(page.items, page.nextCursor, false);
      });
      return () => {
        cancelled = true;
      };
    }, [applyPage, locale]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadFirstPage();
    } finally {
      setRefreshing(false);
    }
  }, [loadFirstPage]);

  const onEndReached = useCallback(() => {
    const cursor = nextCursorRef.current;
    if (!cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    void fetchPostsFeedForLocale(locale, POSTS_FEED_PAGE_SIZE, cursor)
      .then((page) => {
        applyPage(page.items, page.nextCursor, true);
      })
      .finally(() => {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });
  }, [applyPage, locale]);

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
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
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
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footer}>
              <ActivityIndicator color={theme.colors.textMuted} />
            </View>
          ) : nextCursor ? (
            <View style={styles.footerSpacer} />
          ) : null
        }
        renderItem={({ item }) => (
          <VideoCard post={item} onPress={() => router.push(`/post/${item.id}` as Href)} />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
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
  separator: {
    height: 12,
  },
  footer: {
    paddingVertical: 16,
    alignItems: "center",
  },
  footerSpacer: {
    height: 8,
  },
});
