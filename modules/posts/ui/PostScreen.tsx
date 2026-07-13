import { router, useLocalSearchParams } from "expo-router";
import { DateTime } from "luxon";
import { useCallback, useEffect, useRef, useState } from "react";
import {
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
} from "@/modules/posts/core/postsClient";
import { CommentComposer, CommentsSection } from "@/modules/posts/ui/CommentsSection";
import { LinkifiedBody } from "@/modules/posts/ui/LinkifiedBody";
import { AppText } from "@/modules/ui/AppText";
import { StackScreenLayout, StackScrollView } from "@/modules/ui/StackScreenLayout";
import { StateCard } from "@/modules/ui/StateCard";
import { useTheme } from "@/modules/ui/theme";

type PostRow = {
  id: string;
  title: string;
  body: string;
  coverUrl: string | null;
  titleI18n: Record<string, string>;
  bodyI18n: Record<string, string>;
  coverUrlI18n: Record<string, string>;
  publishedAt: string | null;
};

export function PostScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t, locale } = useTranslate();
  const { authUser } = useAuth();
  const userId = authUser?.id ?? null;
  const { id } = useLocalSearchParams<{ id: string }>();
  const scrollRef = useRef<ScrollView>(null);
  const scrollToCommentsAfterSubmit = useRef(false);

  const [post, setPost] = useState<PostRow | null | undefined>(undefined);
  const [comments, setComments] = useState<CommentItem[] | null>(null);

  useEffect(() => {
    if (!id) return;
    void fetchPostById(id).then((item) => {
      if (!item) {
        setPost(null);
        return;
      }
      setPost({
        id: item.id,
        title: item.title,
        body: item.body,
        coverUrl: item.coverUrl,
        titleI18n: item.titleI18n,
        bodyI18n: item.bodyI18n,
        coverUrlI18n: item.coverUrlI18n,
        publishedAt: item.publishedAt,
      });
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
          <View style={styles.stateWrap}>
            <StateCard loading message={t("posts.feed.loading")} />
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
                <Image source={{ uri: localizedPost.coverUrl }} style={styles.cover} resizeMode="cover" />
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
  cover: {
    aspectRatio: 16 / 9,
    borderRadius: 18,
    width: "100%",
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
