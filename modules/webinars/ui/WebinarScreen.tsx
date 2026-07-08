import { router, useLocalSearchParams } from "expo-router";
import { DateTime } from "luxon";
import { useCallback, useEffect, useState } from "react";
import { KeyboardAvoidingView, Linking, Platform, Pressable, StyleSheet, View } from "react-native";

import { requiredTierFor, UpgradeDialog, useAccess } from "@/modules/access";
import { useAuth } from "@/modules/auth";
import { useTranslate } from "@/modules/i18n";
import { CommentsSection, type CommentItem } from "@/modules/posts";
import { fetchComments } from "@/modules/posts/core/postsClient";
import { LinkifiedBody } from "@/modules/posts/ui/LinkifiedBody";
import {
  fetchWebinar,
  isRegistered,
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
  const { t, locale } = useTranslate();
  const { authUser } = useAuth();
  const { canUseFeature } = useAccess();
  const userId = authUser?.id ?? null;
  const { id } = useLocalSearchParams<{ id: string }>();

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
    void fetchComments("webinar", id, userId).then(setQuestions);
  }, [id, userId]);

  const toggleRegistration = useCallback(() => {
    if (!id || !userId) return;
    const next = !registered;
    setRegisteredState(next);
    void setRegistered(id, userId, next);
  }, [id, userId, registered]);

  const onQuestionsChanged = useCallback((next: CommentItem[]) => setQuestions(next), []);

  const canWatchRecording = canUseFeature("webinar_community");
  const isPast = webinar ? new Date(webinar.startsAt).getTime() < Date.now() : false;

  return (
    <StackScreenLayout edges={["top", "left", "right"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.keyboard}>
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
          <View style={styles.stateWrap}>
            <StateCard loading message={t("webinars.loading")} />
          </View>
        ) : webinar === null ? (
          <View style={styles.stateWrap}>
            <StateCard tone="warning" title={t("webinars.notFoundTitle")} message={t("webinars.notFoundMessage")} />
          </View>
        ) : (
          <StackScrollView contentOptions={{ topPadding: 4, gap: 14 }} keyboardShouldPersistTaps="handled">
            <AppText variant="screenTitle" accessibilityRole="header">
              {webinar.title}
            </AppText>
            <AppText variant="sectionTitle" tone="accent">
              {DateTime.fromISO(webinar.startsAt).setLocale(locale).toLocaleString(DateTime.DATETIME_MED_WITH_WEEKDAY)}
            </AppText>
            {webinar.description ? <LinkifiedBody body={webinar.description} /> : null}

            {!isPast ? (
              <AppButton
                label={registered ? t("webinars.unregister") : t("webinars.register")}
                variant={registered ? "secondary" : "primary"}
                onPress={toggleRegistration}
              />
            ) : null}
            {!isPast && registered ? (
              <AppText variant="screenHint" tone="muted">
                {t("webinars.registeredHint")}
              </AppText>
            ) : null}

            {!isPast && webinar.joinUrl && registered ? (
              <AppButton
                label={t("webinars.join")}
                variant="secondary"
                onPress={() => void Linking.openURL(webinar.joinUrl!)}
              />
            ) : null}

            {isPast ? (
              <View
                style={[
                  styles.recordingCard,
                  { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder },
                ]}
              >
                <AppText variant="sectionTitle">{t("webinars.recordingTitle")}</AppText>
                {webinar.recordingUrl ? (
                  canWatchRecording ? (
                    <AppButton
                      label={t("webinars.watchRecording")}
                      variant="primary"
                      onPress={() => void Linking.openURL(webinar.recordingUrl!)}
                    />
                  ) : (
                    <>
                      <AppText variant="screenHint" tone="muted">
                        {t("webinars.recordingLocked")}
                      </AppText>
                      <AppButton
                        label={t("webinars.upgradeCta")}
                        variant="secondary"
                        onPress={() => setShowUpgrade(true)}
                      />
                    </>
                  )
                ) : (
                  <AppText variant="screenHint" tone="muted">
                    {t("webinars.recordingPending")}
                  </AppText>
                )}
              </View>
            ) : null}

            <View style={[styles.divider, { backgroundColor: theme.colors.surfaceBorder }]} />

            <AppText variant="screenHint" tone="muted">
              {t("webinars.questionsHint")}
            </AppText>
            <CommentsSection
              targetType="webinar"
              targetId={webinar.id}
              comments={questions}
              onChanged={onQuestionsChanged}
              inputPlaceholderKey="webinars.questionPlaceholder"
            />
          </StackScrollView>
        )}
      </KeyboardAvoidingView>

      {showUpgrade ? (
        <UpgradeDialog
          visible
          feature="webinar_community"
          requiredTier={requiredTierFor("webinar_community")}
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
  topBar: {
    paddingHorizontal: 20,
    paddingVertical: 4,
  },
  stateWrap: {
    paddingHorizontal: 20,
  },
  recordingCard: {
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    width: "100%",
  },
});
