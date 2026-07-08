import { DateTime } from "luxon";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, View } from "react-native";

import { useAuth } from "@/modules/auth";
import { useTranslate } from "@/modules/i18n";
import {
  addComment,
  deleteOwnComment,
  fetchComments,
  setCommentLike,
  type CommentItem,
  type CommentTargetType,
} from "@/modules/posts/core/postsClient";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

const MAX_COMMENT_LENGTH = 2000;

/**
 * Комментарии к цели (публикация или вебинар) с лайками и удалением своих.
 * Для вебинаров лайк работает как голос за вопрос (сортировку по голосам
 * делает экран вебинара, здесь порядок хронологический).
 */
export function CommentsSection({
  targetType,
  targetId,
  comments,
  onChanged,
  inputPlaceholderKey = "posts.comments.placeholder",
}: {
  targetType: CommentTargetType;
  targetId: string;
  comments: CommentItem[] | null;
  onChanged: (next: CommentItem[]) => void;
  inputPlaceholderKey?: string;
}) {
  const theme = useTheme();
  const { t, tc, locale } = useTranslate();
  const { authUser } = useAuth();
  const userId = authUser?.id ?? null;

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const reload = useCallback(async () => {
    if (!userId) return;
    onChanged(await fetchComments(targetType, targetId, userId));
  }, [userId, targetType, targetId, onChanged]);

  const submit = useCallback(async () => {
    const body = draft.trim();
    if (!body || !userId || sending) return;
    setSending(true);
    try {
      const result = await addComment(targetType, targetId, userId, body);
      if (result.ok) {
        setDraft("");
        await reload();
      } else {
        Alert.alert(t("posts.comments.sendFailed"));
      }
    } finally {
      setSending(false);
    }
  }, [draft, userId, sending, targetType, targetId, reload, t]);

  const toggleLike = useCallback(
    async (comment: CommentItem) => {
      if (!userId) return;
      // Оптимистично: сеть догонит, при ошибке следующий reload вернёт правду.
      onChanged(
        (comments ?? []).map((c) =>
          c.id === comment.id
            ? { ...c, likedByMe: !c.likedByMe, likeCount: c.likeCount + (c.likedByMe ? -1 : 1) }
            : c,
        ),
      );
      await setCommentLike(comment.id, userId, !comment.likedByMe);
    },
    [userId, comments, onChanged],
  );

  const confirmDelete = useCallback(
    (comment: CommentItem) => {
      Alert.alert(t("posts.comments.deleteTitle"), undefined, [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("posts.comments.deleteConfirm"),
          style: "destructive",
          onPress: () => {
            void deleteOwnComment(comment.id).then(reload);
          },
        },
      ]);
    },
    [t, reload],
  );

  return (
    <View style={styles.root}>
      <AppText variant="sectionTitle">
        {comments === null ? t("posts.comments.title") : tc("posts.comments.count", comments.length)}
      </AppText>

      {comments === null ? (
        <ActivityIndicator color={theme.colors.textMuted} />
      ) : comments.length === 0 ? (
        <AppText variant="screenHint" tone="muted">
          {t("posts.comments.empty")}
        </AppText>
      ) : (
        comments.map((comment) => (
          <View
            key={comment.id}
            style={[
              styles.comment,
              { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder },
            ]}
          >
            <View style={styles.commentHeader}>
              <AppText variant="buttonLabel" numberOfLines={1} style={styles.commentAuthor}>
                {comment.displayName ?? t("posts.comments.anonymous")}
              </AppText>
              <AppText variant="technicalCaption" tone="faint">
                {DateTime.fromISO(comment.createdAt).setLocale(locale).toRelative() ?? ""}
              </AppText>
            </View>
            <AppText variant="screenHint">{comment.body}</AppText>
            <View style={styles.commentActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("posts.comments.likeA11y")}
                onPress={() => void toggleLike(comment)}
                style={({ pressed }) => [styles.likeButton, { opacity: pressed ? 0.6 : 1 }]}
              >
                <AppText variant="technicalCaption" tone={comment.likedByMe ? "accent" : "faint"}>
                  {comment.likedByMe ? "♥" : "♡"} {comment.likeCount > 0 ? comment.likeCount : ""}
                </AppText>
              </Pressable>
              {comment.isMine ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => confirmDelete(comment)}
                  style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                >
                  <AppText variant="technicalCaption" tone="faint">
                    {t("posts.comments.delete")}
                  </AppText>
                </Pressable>
              ) : null}
            </View>
          </View>
        ))
      )}

      <View
        style={[
          styles.inputRow,
          { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder },
        ]}
      >
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t(inputPlaceholderKey)}
          placeholderTextColor={theme.colors.textFaint}
          multiline
          maxLength={MAX_COMMENT_LENGTH}
          style={[styles.input, { color: theme.colors.textPrimary }]}
        />
        <Pressable
          accessibilityRole="button"
          disabled={sending || !draft.trim()}
          onPress={() => void submit()}
          style={({ pressed }) => [styles.sendButton, { opacity: pressed || sending || !draft.trim() ? 0.5 : 1 }]}
        >
          {sending ? (
            <ActivityIndicator size="small" color={theme.colors.accent} />
          ) : (
            <AppText variant="buttonLabel" tone="accent">
              {t("posts.comments.send")}
            </AppText>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 12,
  },
  comment: {
    borderRadius: 14,
    borderWidth: 1,
    gap: 6,
    padding: 12,
  },
  commentHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  commentAuthor: {
    flexShrink: 1,
  },
  commentActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: 16,
  },
  likeButton: {
    paddingVertical: 2,
  },
  inputRow: {
    alignItems: "flex-end",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  input: {
    flex: 1,
    fontSize: 15,
    maxHeight: 120,
    paddingTop: 4,
  },
  sendButton: {
    paddingBottom: 4,
    paddingHorizontal: 4,
  },
});
