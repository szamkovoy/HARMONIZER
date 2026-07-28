import { router, useLocalSearchParams } from "expo-router";
import { DateTime } from "luxon";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/modules/auth";
import { useTranslate } from "@/modules/i18n";
import {
  fetchComments,
  fetchPostById,
  markPostViewed,
  resolvePostContentForLocale,
  type CommentItem,
  type PostItem,
} from "@/modules/posts/core/postsClient";
import { formatVideoDuration } from "@/modules/posts/core/videoDuration";
import { CommentComposer, CommentsSection } from "@/modules/posts/ui/CommentsSection";
import { LinkifiedBody } from "@/modules/posts/ui/LinkifiedBody";
import { AppText } from "@/modules/ui/AppText";
import { StackScreenLayout, StackScrollView } from "@/modules/ui/StackScreenLayout";
import { StateCard } from "@/modules/ui/StateCard";
import { useTheme } from "@/modules/ui/theme";

export function PostScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t, locale } = useTranslate();
  const { authUser } = useAuth();
  const userId = authUser?.id ?? null;
  const { id } = useLocalSearchParams<{ id: string }>();
  const scrollRef = useRef<ScrollView>(null);
  const scrollToCommentsAfterSubmit = useRef(false);

  const [post, setPost] = useState<PostItem | null | undefined>(undefined);
  const [comments, setComments] = useState<CommentItem[] | null>(null);

  useEffect(() => {
    if (!id) return;
    void fetchPostById(id).then((item) => {
      setPost(item);
    });
  }, [id]);

  useEffect(() => {
    if (!id || !userId) return;
    void markPostViewed(userId, id);
  }, [id, userId]);

  useEffect(() => {
    if (!id || !userId) return;
    void fetchComments("post", id, userId, locale).then(setComments);
  }, [id, userId, locale]);

  const onCommentsChanged = useCallback((next: CommentItem[]) => setComments(next), []);

  const onCommentSubmitted = useCallback(() => {
    scrollToCommentsAfterSubmit.current = true;
  }, []);

  const localizedPost = post ? resolvePostContentForLocale(post, locale) : null;

  return (
    <StackScreenLayout edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
        style={styles.keyboard}
      >
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("posts.post.backA11y")}
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/posts"))}
            hitSlop={12}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <AppText variant="screenTitle" tone="muted">
              ‹
            </AppText>
          </Pressable>
        </View>

        {post === undefined ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        ) : post === null || localizedPost == null ? (
          <View style={styles.stateWrap}>
            <StateCard tone="warning" title={t("posts.post.notFoundTitle")} message={t("posts.post.notFoundMessage")} />
          </View>
        ) : (
          <>
            <StackScrollView
              ref={scrollRef}
              contentOptions={{ topPadding: 4, gap: 14, bottomPaddingExtra: 12 }}
              keyboardShouldPersistTaps="handled"
              style={styles.scroll}
              onContentSizeChange={() => {
                if (!scrollToCommentsAfterSubmit.current) return;
                scrollToCommentsAfterSubmit.current = false;
                scrollRef.current?.scrollToEnd({ animated: true });
              }}
            >
              {localizedPost.coverUrl ? (
                <View style={styles.coverWrap}>
                  <Image
                    source={{ uri: localizedPost.coverUrl }}
                    style={styles.cover}
                    resizeMode="cover"
                  />
                  {post.durationSeconds != null && post.durationSeconds > 0 ? (
                    <View style={styles.durationBadge} pointerEvents="none">
                      <AppText style={styles.durationText}>
                        {formatVideoDuration(post.durationSeconds)}
                      </AppText>
                    </View>
                  ) : null}
                </View>
              ) : null}
              <AppText variant="screenTitle" accessibilityRole="header">
                {localizedPost.title}
              </AppText>
              {post.publishedAt ? (
                <AppText variant="technicalCaption" tone="faint">
                  {DateTime.fromISO(post.publishedAt).setLocale(locale).toLocaleString(DateTime.DATE_FULL)}
                </AppText>
              ) : null}
              {localizedPost.body ? <LinkifiedBody body={localizedPost.body} /> : null}

              <View style={[styles.divider, { backgroundColor: theme.colors.surfaceBorder }]} />

              <CommentsSection
                targetType="post"
                targetId={post.id}
                comments={comments}
                onChanged={onCommentsChanged}
                showComposer={false}
              />
            </StackScrollView>
            <View
              style={[
                styles.composerDock,
                {
                  borderTopColor: theme.colors.surfaceBorder,
                  backgroundColor: theme.colors.screenBg,
                  paddingBottom: Math.max(insets.bottom, 8),
                },
              ]}
            >
              <CommentComposer
                targetType="post"
                targetId={post.id}
                onChanged={onCommentsChanged}
                onSubmitted={onCommentSubmitted}
              />
            </View>
          </>
        )}
      </KeyboardAvoidingView>
    </StackScreenLayout>
  );
}

const styles = StyleSheet.create({
  keyboard: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  topBar: {
    paddingHorizontal: 20,
    paddingVertical: 4,
  },
  stateWrap: {
    paddingHorizontal: 20,
  },
  loadingWrap: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  coverWrap: {
    aspectRatio: 16 / 9,
    borderRadius: 18,
    overflow: "hidden",
    position: "relative",
    width: "100%",
  },
  cover: {
    height: "100%",
    width: "100%",
  },
  durationBadge: {
    backgroundColor: "rgba(0,0,0,0.82)",
    borderRadius: 4,
    bottom: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    position: "absolute",
    right: 8,
  },
  durationText: {
    color: "#fff",
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    fontWeight: "600",
    lineHeight: 16,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    width: "100%",
  },
  composerDock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
});
