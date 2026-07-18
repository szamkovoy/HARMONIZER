import { Image } from "expo-image";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { DateTime } from "luxon";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AccountGateDialog, useAccess } from "@/modules/access";
import { useAuth } from "@/modules/auth";
import { useTranslate } from "@/modules/i18n";
import { CommentsSection, type CommentItem } from "@/modules/posts";
import { fetchComments } from "@/modules/posts/core/postsClient";
import { CommentComposer } from "@/modules/posts/ui/CommentsSection";
import { LinkifiedBody } from "@/modules/posts/ui/LinkifiedBody";
import { isWebinarInJoinWindow } from "@/modules/webinars/core/webinarTiming";
import {
  fetchWebinar,
  isRegistered,
  localizeWebinar,
  setRegistered,
  type WebinarItem,
} from "@/modules/webinars/core/webinarsClient";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { StackScreenLayout, StackScrollView } from "@/modules/ui/StackScreenLayout";
import { StateCard } from "@/modules/ui/StateCard";
import { useTheme } from "@/modules/ui/theme";

export function WebinarScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { t, locale } = useTranslate();
  const { authUser } = useAuth();
  const { canUseFeature } = useAccess();
  const userId = authUser?.id ?? null;
  const { id } = useLocalSearchParams<{ id: string }>();
  const scrollRef = useRef<ScrollView>(null);
  const scrollToQuestionsAfterSubmit = useRef(false);

  const [webinar, setWebinar] = useState<WebinarItem | null | undefined>(undefined);
  const [registered, setRegisteredState] = useState(false);
  const [questions, setQuestions] = useState<CommentItem[] | null>(null);
  const [showUpgrade, setShowUpgrade] = useState(false);

  useEffect(() => {
    if (!id) return;
    void fetchWebinar(id).then(setWebinar);
  }, [id]);

  useEffect(() => {
    if (!id || !userId) return;
    void isRegistered(id, userId).then(setRegisteredState);
    void fetchComments("webinar", id, userId, locale).then(setQuestions);
  }, [id, userId, locale]);

  // Возврат из Личного кабинета после оплаты разового вебинара: повторно
  // проверяем регистрацию, чтобы экран обновился (кнопка «Записаться» ->
  // «Вы записаны» + ссылка на трансляцию) без перезапуска экрана.
  useEffect(() => {
    if (!id || !userId) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void isRegistered(id, userId).then(setRegisteredState);
    });
    return () => sub.remove();
  }, [id, userId]);

  const localized = useMemo(
    () => (webinar ? localizeWebinar(webinar, locale) : null),
    [webinar, locale],
  );

  const register = useCallback(() => {
    if (!id || !userId) return;
    if (!canUseFeature("webinar_community")) {
      setShowUpgrade(true);
      return;
    }
    setRegisteredState(true);
    void setRegistered(id, userId, true);
  }, [canUseFeature, id, userId]);

  const onQuestionsChanged = useCallback((next: CommentItem[]) => setQuestions(next), []);

  const onQuestionSubmitted = useCallback(() => {
    scrollToQuestionsAfterSubmit.current = true;
  }, []);

  const inJoinWindow = webinar ? isWebinarInJoinWindow(webinar.startsAt) : false;

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
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
            hitSlop={12}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <AppText variant="screenTitle" tone="muted">
              ‹
            </AppText>
          </Pressable>
        </View>

        {webinar === undefined ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        ) : webinar === null || !localized ? (
          <View style={styles.stateWrap}>
            <StateCard tone="warning" title={t("webinars.notFoundTitle")} message={t("webinars.notFoundMessage")} />
          </View>
        ) : (
          <>
            <StackScrollView
              ref={scrollRef}
              contentOptions={{ topPadding: 4, gap: 14, bottomPaddingExtra: 12 }}
              keyboardShouldPersistTaps="handled"
              style={styles.scroll}
              onContentSizeChange={() => {
                if (!scrollToQuestionsAfterSubmit.current) return;
                scrollToQuestionsAfterSubmit.current = false;
                scrollRef.current?.scrollToEnd({ animated: true });
              }}
            >
              {localized.coverUrl ? (
                <Image source={{ uri: localized.coverUrl }} style={styles.cover} contentFit="cover" />
              ) : null}

              <AppText variant="screenTitle" accessibilityRole="header">
                {localized.title}
              </AppText>
              <AppText variant="buttonLabel" tone="accent">
                {DateTime.fromISO(localized.startsAt)
                  .setLocale(locale)
                  .toLocaleString({
                    weekday: "short",
                    day: "numeric",
                    month: "long",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                ({t("webinars.yourTimezone")})
              </AppText>
              {localized.description ? <LinkifiedBody body={localized.description} /> : null}

              {inJoinWindow ? (
                <View
                  style={[
                    styles.regCard,
                    { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder },
                  ]}
                >
                  {!registered ? (
                    <AppButton
                      label={t("webinars.register")}
                      variant="primary"
                      onPress={register}
                    />
                  ) : (
                    <>
                      <AppText variant="sectionTitle">{t("webinars.registeredTitle")}</AppText>
                      <AppText variant="screenHint" tone="muted">
                        {t("webinars.registeredBody")}
                      </AppText>
                      {localized.joinUrl ? (
                        <AppButton
                          label={t("webinars.join")}
                          variant="primary"
                          onPress={() => void Linking.openURL(localized.joinUrl!)}
                        />
                      ) : (
                        <AppText variant="screenHint" tone="muted">
                          {t("webinars.joinPending")}
                        </AppText>
                      )}
                    </>
                  )}
                </View>
              ) : null}

              {!inJoinWindow && registered && localized.recordingPostId ? (
                <AppButton
                  label={t("webinars.watchRecording")}
                  variant="primary"
                  onPress={() => router.push(`/post/${localized.recordingPostId}` as Href)}
                />
              ) : null}
              {!inJoinWindow && registered && !localized.recordingPostId && localized.recordingUrl ? (
                <AppButton
                  label={t("webinars.watchRecording")}
                  variant="primary"
                  onPress={() => void Linking.openURL(localized.recordingUrl!)}
                />
              ) : null}
              {!inJoinWindow && registered && !localized.recordingPostId && !localized.recordingUrl ? (
                <AppText variant="screenHint" tone="muted">
                  {t("webinars.recordingPending")}
                </AppText>
              ) : null}
              {!inJoinWindow && !registered ? (
                <AppText variant="screenHint" tone="muted">
                  {t("webinars.recordingRegistrantsOnly")}
                </AppText>
              ) : null}

              {inJoinWindow ? (
                <>
                  <View style={[styles.divider, { backgroundColor: theme.colors.surfaceBorder }]} />
                  <CommentsSection
                    targetType="webinar"
                    targetId={webinar.id}
                    comments={questions}
                    onChanged={onQuestionsChanged}
                    showComposer={false}
                    headingKey="webinars.questionsTitle"
                    hintKey="webinars.questionsHint"
                    inputPlaceholderKey="webinars.questionPlaceholder"
                  />
                </>
              ) : null}
            </StackScrollView>

            {inJoinWindow ? (
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
                  targetType="webinar"
                  targetId={webinar.id}
                  onChanged={onQuestionsChanged}
                  onSubmitted={onQuestionSubmitted}
                  inputPlaceholderKey="webinars.questionPlaceholder"
                />
              </View>
            ) : null}
          </>
        )}
      </KeyboardAvoidingView>

      {showUpgrade ? (
        <AccountGateDialog
          visible
          feature="webinar_community"
          onClose={() => setShowUpgrade(false)}
        />
      ) : null}
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
  cover: {
    aspectRatio: 16 / 9,
    borderRadius: 16,
    width: "100%",
  },
  regCard: {
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
    padding: 14,
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
