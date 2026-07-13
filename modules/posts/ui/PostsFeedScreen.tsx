import { useFocusEffect } from "@react-navigation/native";
import { router, type Href } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";

import { useTranslate } from "@/modules/i18n";
import { fetchPostsFeedForLocale, type PostItem } from "@/modules/posts/core/postsClient";
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
});
