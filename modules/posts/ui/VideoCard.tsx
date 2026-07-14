import { DateTime } from "luxon";
import { Image, Pressable, StyleSheet, View } from "react-native";

import { useTranslate } from "@/modules/i18n";
import {
  resolvePostContentForLocale,
  truncatePostPreview,
  type PostItem,
} from "@/modules/posts/core/postsClient";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

/** Shared vertical rhythm for title → preview → meta (home + Videos tab). */
const CARD_SECTION_GAP = 10;

/**
 * Shared video card for feed + home announcement.
 * Entire card is pressable; subtle «Открыть ›» affordance at the bottom.
 * Preview length is word-bounded (no mid-word clip, no layout-dependent numberOfLines).
 */
export function VideoCard({
  post,
  onPress,
}: {
  post: PostItem;
  onPress: () => void;
}) {
  const theme = useTheme();
  const { t, locale } = useTranslate();
  const content = resolvePostContentForLocale(post, locale);
  if (!content) return null;

  const dateLabel = post.publishedAt
    ? DateTime.fromISO(post.publishedAt).setLocale(locale).toLocaleString(DateTime.DATE_MED)
    : "";
  const preview = content.body ? truncatePostPreview(content.body) : "";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${content.title}. ${t("posts.feed.open")}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.colors.surfaceElevated,
          borderColor: theme.colors.surfaceBorder,
          opacity: pressed ? 0.88 : 1,
        },
      ]}
    >
      {content.coverUrl ? (
        <Image source={{ uri: content.coverUrl }} style={styles.cover} resizeMode="cover" />
      ) : null}
      <View style={styles.cardBody}>
        <AppText variant="sectionTitle">{content.title}</AppText>
        {preview ? (
          <AppText variant="screenHint" tone="muted">
            {preview}
          </AppText>
        ) : null}
        <View style={styles.metaRow}>
          <AppText variant="technicalCaption" tone="faint" style={styles.metaText}>
            {dateLabel}
            {dateLabel ? "  ·  " : ""}
            {t("posts.comments.countLabel", { count: post.commentCount })}
          </AppText>
          <AppText variant="technicalCaption" tone="accent">
            {t("posts.feed.open")} ›
          </AppText>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
    width: "100%",
  },
  cover: {
    aspectRatio: 16 / 9,
    width: "100%",
  },
  cardBody: {
    gap: CARD_SECTION_GAP,
    paddingBottom: 14,
    paddingHorizontal: 14,
    paddingTop: CARD_SECTION_GAP,
  },
  metaRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  metaText: {
    flex: 1,
    minWidth: 0,
  },
});
