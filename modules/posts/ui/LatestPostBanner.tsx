import { useFocusEffect } from "@react-navigation/native";
import { router, type Href } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { useTranslate } from "@/modules/i18n";
import {
  fetchLatestPostForLocale,
  resolvePostContentForLocale,
  type PostItem,
} from "@/modules/posts/core/postsClient";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

/**
 * Анонс новейшего видео на главной. Рендерит null, если для текущей локали нет контента.
 * Этап 3 добавит приоритет: анонс ближайшего вебинара вытесняет публикацию.
 */
export function LatestPostBanner() {
  const theme = useTheme();
  const { t, locale } = useTranslate();
  const [post, setPost] = useState<PostItem | null>(null);

  const reload = useCallback(() => {
    let cancelled = false;
    void fetchLatestPostForLocale(locale).then((item) => {
      if (!cancelled) setPost(item);
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  useFocusEffect(reload);

  if (!post) return null;

  const content = resolvePostContentForLocale(post, locale);
  if (!content) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("posts.banner.a11y")}
      onPress={() => router.push(`/post/${post.id}` as Href)}
      style={({ pressed }) => [
        styles.banner,
        {
          backgroundColor: theme.colors.controlButtonBg,
          borderColor: theme.colors.surfaceBorder,
          opacity: pressed ? 0.72 : 1,
        },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: theme.colors.accent }]} />
      <AppText variant="technicalCaption" tone="muted" numberOfLines={1} style={styles.text}>
        {t("posts.banner.label")} · {content.title}
      </AppText>
      <AppText variant="sectionTitle" tone="muted" style={styles.arrow}>
        ›
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dot: {
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  text: {
    flex: 1,
  },
  arrow: {
    marginTop: -2,
  },
});
