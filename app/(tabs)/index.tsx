import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/modules/auth";
import { AccountGateDialog, AccountUpsellPanel, DevTierSwitch as AccessDevTierSwitch, accessModeForTier, useAccess, type FeatureKey, type ProductTier } from "@/modules/access";
import type { BirthData, NatalProfile } from "@/modules/astro-core";
import { Communicator } from "@/modules/communicator/ui/Communicator";
import type { DailyForecast } from "@/modules/daily-engine";
import { getHomeStrings, resolveLocationErrorMessage, type HomeStrings } from "@/modules/home/i18n/home";
import { useAppLocale } from "@/modules/i18n";
import { intlLocaleTag } from "@/modules/i18n/localeCodes";
import { PLANET_CHAKRA } from "@/modules/home/planetChakra";
import { useDayContent } from "@/modules/home/useDayContent";
import { NatalBirthDataModal } from "@/modules/home/ui/NatalBirthDataModal";
import { ChakraFlower } from "@/modules/home/ui/ChakraFlower";
import { DailyRecommendationCard } from "@/modules/home/ui/DailyRecommendationCard";
import { GeoGate } from "@/modules/home/ui/GeoGate";
import { OpportunityWindows } from "@/modules/home/ui/OpportunityWindows";
import { launchPractice } from "@/modules/practices/ui/launchPractice";
import { AssistantModalShell } from "@/modules/ui/AssistantModalShell";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { BlockingStatusToast } from "@/modules/ui/BlockingStatusToast";
import { StateCard } from "@/modules/ui/StateCard";
import { TabScreenLayout, TabScrollView } from "@/modules/ui/TabScreenLayout";
import { HARMONIZER_TEST_MODE } from "@/modules/ui/testMode";
import { useTheme } from "@/modules/ui/theme";
import { postDevDayContentReset, type DevDayContentResetScope } from "@/services/devDayContentResetClient";
import type { DayHealthContext } from "@/services/dayHealthContext";
import { buildSummarizingHealthSnapshot } from "@/services/summarizingHealthContext";
import { loadDayPlan, savePendingDayPractice, type DayPlan } from "@/services/dayPlan";
import { isDayPlanCurrent, peekCachedDayPlan } from "@/services/dayPlanCache";
import { ensureDayPlanPrefetch } from "@/services/dayPlanPrefetch";
import { peekPrefetchedDayPlan, storePrefetchedDayPlan } from "@/services/dayPlanReloadRequest";
import { clearHomeDailyDialogCache } from "@/services/dialogSessionCache";
import {
  buildOpportunityAlarmStyleContent,
  getExpoNotificationsOrNull,
  OPPORTUNITY_REMINDERS_CHANNEL_ID,
} from "@/services/localNotifications";
import { consumeHomeDayContentBlockingReload } from "@/services/homeDayContentReloadRequest";
import { dayTextsMatchLocale } from "@/services/dayContentLocaleGuard";
import { createNatalProfile, fetchActiveNatalProfileCached } from "@/services/natalProfileClient";
import { LatestPostBanner } from "@/modules/posts";
import { StoriesRing } from "@/modules/stories";
import {
  ensureNotificationPermission,
  registerPushToken,
} from "@/modules/notifications";
import { UpcomingWebinarBanner } from "@/modules/webinars";
import { requireSupabase } from "@/services/supabase";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import { resolveUserFacingAlert } from "@/services/userFacingErrors";
import { logRuntimeEvent } from "@/services/runtimeDiagnostics";

function errorMessage(value: unknown, fallback = "Неизвестная ошибка"): string {
  if (value instanceof Error && value.message.trim()) return value.message;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    const error = value as { message?: unknown; error?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const message = [error.message, error.error, error.details, error.hint, error.code]
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
      .join(" ");
    if (message) return message;
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function birthFingerprintFromProfile(
  profile: {
    birth_date?: string | null;
    birth_time?: string | null;
    birth_place?: unknown;
  } | null | undefined,
): string | null {
  if (!profile?.birth_date) return null;
  const place =
    typeof profile.birth_place === "string" ? profile.birth_place : JSON.stringify(profile.birth_place ?? null);
  return [profile.birth_date ?? "", profile.birth_time ?? "", place].join("|");
}

function formatHomeHeaderDate(locale: HomeStrings["locale"]): string {
  const raw = new Intl.DateTimeFormat(intlLocaleTag(locale), {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  // Intl already uses locale month casing (lowercase in RU/Romance, title case in EN/DE).
  // Capitalize only the first character so the header reads as a sentence.
  if (!raw) return raw;
  return raw.charAt(0).toLocaleUpperCase(intlLocaleTag(locale)) + raw.slice(1);
}

function HomeHeader({
  forecast,
  strings,
}: {
  forecast: DailyForecast | null;
  strings: HomeStrings;
  homeTextsLoading?: boolean;
}) {
  const today = formatHomeHeaderDate(strings.locale);
  const slogan = forecast?.slogan?.trim() ?? "";
  const showSlogan =
    Boolean(slogan) &&
    dayTextsMatchLocale(strings.locale, slogan, String(forecast?.recommendationShortText ?? ""));
  return (
    <View style={styles.header}>
      <View style={styles.heroRow}>
        <StoriesRing />
        <View style={styles.headerText}>
          <AppText variant="sectionTitle" accessibilityRole="header">
            {today}
          </AppText>
          {showSlogan ? (
            <AppText variant="screenHint" tone="muted">
              {slogan}
            </AppText>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function HomeError({
  title,
  message,
  tone,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
}: {
  title: string;
  message: string;
  tone: "warning" | "danger";
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}) {
  return (
    <StateCard
      title={title}
      message={message}
      tone={tone}
      actionLabel={actionLabel}
      onAction={onAction}
      secondaryActionLabel={secondaryActionLabel}
      onSecondaryAction={onSecondaryAction}
    />
  );
}

function HomeLoadingSkeleton({ text }: { text: string }) {
  return <StateCard loading message={text} />;
}

function HomeStaleNotice({ title, message }: { title: string; message: string }) {
  return <StateCard title={title} message={message} tone="warning" />;
}

/** Только HARMONIZER_TEST_MODE: проверка `expo-notifications` без ожидания окна возможностей. */
function DevLocalNotificationTestButton() {
  const theme = useTheme();
  if (Platform.OS === "web") return null;

  const scheduleProbe = useCallback(async () => {
    const Notifications = getExpoNotificationsOrNull();
    if (!Notifications) {
      Alert.alert("Dev", "В сборке нет expo-notifications (нужен dev/release build с нативным модулем).");
      return;
    }
    const perms = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowSound: true, allowBadge: false },
    });
    const iosOk =
      perms.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL ||
      perms.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED;
    if (!perms.granted && !iosOk) {
      Alert.alert("Dev", "Нет разрешения на уведомления.");
      return;
    }
    const when = new Date(Date.now() + 20_000);
    const androidChannelId = Platform.OS === "android" ? OPPORTUNITY_REMINDERS_CHANNEL_ID : undefined;
    try {
      const id = await Notifications.scheduleNotificationAsync({
        content: buildOpportunityAlarmStyleContent({
          title: "Harmonizer · dev",
          body: `Тестовое уведомление (~20 с, ${when.toLocaleTimeString()})`,
          data: { source: "dev_local_notification_probe" },
        }),
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: when,
          ...(androidChannelId ? { channelId: androidChannelId } : {}),
        },
      });
      Alert.alert("Dev", "Запланировано. Через ~20 с должен появиться системный алерт со звуком (приложение можно свернуть).", [
        { text: "OK" },
        {
          text: "Показать ID",
          onPress: () => Alert.alert("Dev", `Идентификатор запланированного уведомления:\n\n${id}`),
        },
      ]);
    } catch (e) {
      Alert.alert("Dev", errorMessage(e, "Не удалось запланировать."));
    }
  }, []);

  return (
    <View style={{ alignSelf: "stretch", gap: 6, marginTop: 4 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Запланировать тестовое уведомление через 20 секунд"
        onPress={() => void scheduleProbe()}
        style={({ pressed }) => [
          styles.devPill,
          {
            alignSelf: "center",
            borderColor: theme.colors.accent,
            backgroundColor: theme.colors.controlButtonBg,
            opacity: pressed ? 0.75 : 1,
          },
        ]}
      >
        <AppText variant="technicalCaption">Тест уведомления (~20 с)</AppText>
      </Pressable>
      <AppText variant="technicalCaption" tone="muted" style={{ textAlign: "center" }}>
        Только в dev-сборке. Не связано с окнами возможностей.
      </AppText>
    </View>
  );
}

function DevLinks({ strings, leadingAccessory }: { strings: HomeStrings; leadingAccessory?: ReactNode }) {
  const theme = useTheme();
  const links = [
    { label: strings.devLinks.biofeedback, href: "/biofeedback-probe" },
    { label: strings.devLinks.biofeedbackParity, href: "/biofeedback-parity" },
    { label: strings.devLinks.mandala, href: "/mandala-sandbox" },
    { label: strings.devLinks.bindu, href: "/bindu-succession-lab" },
    { label: strings.devLinks.symbols, href: "/sacred-symbol-stream" },
    { label: strings.devLinks.breath, href: "/breath-coherence" },
    { label: "Практики", href: "/practices" },
    { label: strings.devLinks.calibration, href: "/calibration" },
  ];

  return (
    <View style={styles.devLinks}>
      {leadingAccessory}
      {links.map((link) => (
        <Pressable
          key={link.href}
          accessibilityRole="button"
          onPress={() => router.push(link.href as never)}
          style={({ pressed }) => [
            styles.devPill,
            {
              borderColor: theme.colors.surfaceBorder,
              backgroundColor: theme.colors.controlButtonBg,
              opacity: pressed ? 0.75 : 1,
            },
          ]}
        >
          <AppText variant="technicalCaption">{link.label}</AppText>
        </Pressable>
      ))}
    </View>
  );
}

function NatalBridgeCard({ onOpen, label }: { onOpen: () => void; label: string }) {
  return <AppButton label={label} variant="secondary" onPress={onOpen} />;
}

function CommunicatorOverlay({
  forecast,
  accessMode,
  strings,
  dayHealthContext,
  dayPractices,
  workingLocalDate,
  timeZone,
  visible,
  dismissAnimation,
  onDismiss,
  onClose,
  onPracticeStarted,
  onFirstAssistantVisible,
  remountKey,
  devAccessTierOverride,
}: {
  forecast: DailyForecast;
  accessMode: "free" | "premium" | "trial";
  strings: HomeStrings;
  dayHealthContext: DayHealthContext | null;
  dayPractices: DayPlan["sections"][number]["practices"];
  workingLocalDate: string | null;
  timeZone: string | null;
  visible: boolean;
  dismissAnimation: "slide" | "none";
  onDismiss: () => void;
  onClose: () => void;
  onPracticeStarted: () => void;
  onFirstAssistantVisible?: () => void;
  remountKey: number;
  /** Only when DevTierSwitch is active — server honors for practice-branch FSM. */
  devAccessTierOverride?: ProductTier | null;
}) {
  const [practiceHandoff, setPracticeHandoff] = useState(false);

  const finishPracticeLaunch = useCallback(() => {
    setPracticeHandoff(false);
    onPracticeStarted();
  }, [onPracticeStarted]);

  useEffect(() => {
    if (visible) return;
    setPracticeHandoff(false);
  }, [visible]);

  return (
    <AssistantModalShell
      visible={visible}
      animationType={dismissAnimation}
      title={strings.assistantTitle}
      closeLabel={strings.closeButton}
      closeAccessibilityLabel={strings.closeAssistantAccessibilityLabel}
      handoffVisible={practiceHandoff}
      onClose={onClose}
      onDismiss={onDismiss}
    >
      <Communicator
        key={`home-${forecast.date}-${remountKey}`}
        systemPrompt={strings.defaultSystemPrompt}
        locale={strings.locale}
        useCase="daily_dialog"
        entrySource="home"
        startFreshSession
        triggerMeta={{
          clientGreetingShown: true,
          forecastDate: forecast.date,
          planetOfTheDay: forecast.planetOfTheDay,
          chakraLabel: PLANET_CHAKRA[forecast.planetOfTheDay].chakraName,
          todayTone: forecast.todayPlanetState.todayTone,
          harmoniousnessValue: forecast.todayPlanetState.naturalHarmoniousness,
          harmoniousnessLabel:
            forecast.todayPlanetState.naturalHarmoniousness > 0.3
              ? "гармоничная"
              : forecast.todayPlanetState.naturalHarmoniousness < -0.3
                ? "дисгармоничная"
                : "смешанная",
          windowsOfOpportunity: forecast.windowsOfOpportunity,
          dayPractices,
          ...(workingLocalDate ? { workingLocalDate } : {}),
          ...(dayHealthContext ? { dayHealthContext } : {}),
          ...(timeZone ? { timeZone } : {}),
          ...(devAccessTierOverride ? { devAccessTierOverride } : {}),
        }}
        memoryWindow={24}
        onPracticeOffered={async (practice) => {
          await savePendingDayPractice(forecast.date, practice);
        }}
        onMessage={(message) => {
          // Pre-warm the Day tab the moment planning is finalized (recommendation +
          // actions persisted), so closing the dialog opens Day instantly with content.
          if (message.role !== "assistant") return;
          if (!assistantMessageTriggersDayPrefetch(message.meta)) return;
          void loadDayPlan()
            .then(storePrefetchedDayPlan)
            .catch((error) => {
              console.warn("[Home] Failed to pre-warm Day during planning final", error);
            });
        }}
        onFirstAssistantVisible={onFirstAssistantVisible}
        onError={() => onFirstAssistantVisible?.()}
        onPracticeLaunchStart={() => setPracticeHandoff(true)}
        onPracticeLaunchAbort={() => setPracticeHandoff(false)}
        onPracticePicked={finishPracticeLaunch}
        onRequestClose={onClose}
      />
    </AssistantModalShell>
  );
}

/**
 * True when an assistant turn just persisted planning actions / summary or
 * finalized planning — the moment to pre-warm the Day tab so it is ready
 * instantly when the user closes the dialog. Mirrors the Day-tab handler.
 */
function assistantMessageTriggersDayPrefetch(meta: Record<string, unknown> | undefined): boolean {
  const persistence = meta?.planningPersistence as
    | { inserted?: unknown[]; updated?: unknown[]; summarized?: unknown[] }
    | null
    | undefined;
  const inserted = Array.isArray(persistence?.inserted) ? persistence!.inserted! : [];
  const updated = Array.isArray(persistence?.updated) ? persistence!.updated! : [];
  const summarized = Array.isArray(persistence?.summarized) ? persistence!.summarized! : [];
  const isFinalWithoutPractice = meta?.turnMode === "final_without_practice";
  const hasRecommendation = Boolean(meta?.recommendationCorrected);
  return (
    inserted.length > 0 ||
    updated.length > 0 ||
    summarized.length > 0 ||
    hasRecommendation ||
    isFinalWithoutPractice
  );
}

function dayPlanHasVisibleContent(plan: Awaited<ReturnType<typeof loadDayPlan>>): boolean {
  if (plan.mode !== "current_day") return false;
  const todaySection = plan.sections.find((section) => section.localDate === plan.currentLocalDate) ?? plan.sections[0];
  // Navigate straight to the Day tab ONLY when the day already has planned/summarized
  // actions. A leftover pending practice card alone must NOT short-circuit the
  // dialog: with no actions yet, "Что делать?" should open the communicator and
  // start the standard flow (summarize due events, else plan today).
  return (todaySection?.actions.length ?? 0) > 0;
}

function profileHasBirthData(profile: { birth_date?: string | null } | null | undefined): boolean {
  return Boolean(typeof profile?.birth_date === "string" && profile.birth_date.trim());
}

export default function HomeScreen() {
  const theme = useTheme();
  const { authUser, profile, signOut, signingIn, refreshProfile, profileLoading } = useAuth();
  const { access, canUseFeature, setDevTierOverride } = useAccess();
  const needsPersonalForecast = canUseFeature("personal_daily_forecast");
  const { locale: appLocale } = useAppLocale();
  const strings = useMemo(() => getHomeStrings(appLocale), [appLocale]);
  const [communicatorMounted, setCommunicatorMounted] = useState(false);
  const [communicatorVisible, setCommunicatorVisible] = useState(false);
  const [communicatorDismissAnimation, setCommunicatorDismissAnimation] = useState<"slide" | "none">("slide");
  const [homeDayHealthContext, setHomeDayHealthContext] = useState<DayHealthContext | null>(null);
  const [homeDayPractices, setHomeDayPractices] = useState<DayPlan["sections"][number]["practices"]>([]);
  const [homeWorkingLocalDate, setHomeWorkingLocalDate] = useState<string | null>(null);
  const [homeDayTimeZone, setHomeDayTimeZone] = useState<string | null>(null);
  const [natalBridgeOpen, setNatalBridgeOpen] = useState(false);
  const [natalSaving, setNatalSaving] = useState(false);
  const [devDayResetBusy, setDevDayResetBusy] = useState(false);
  const [assistantRemountKey, setAssistantRemountKey] = useState(0);
  const [natalProfile, setNatalProfile] = useState<NatalProfile | null>(null);
  const [upgradeFeature, setUpgradeFeature] = useState<FeatureKey | null>(null);
  const [assistantOpening, setAssistantOpening] = useState(false);
  const birthFingerprint = useMemo(
    () =>
      birthFingerprintFromProfile({
        birth_date: profile?.birth_date,
        birth_time: profile?.birth_time,
        birth_place: profile?.birth_place,
      }),
    [profile?.birth_date, profile?.birth_place, profile?.birth_time],
  );
  // Personal forecast needs birth fields in `users`, not a successful chart row fetch (chart is UI-only).
  const hasBirthDataForForecast = !needsPersonalForecast
    ? true
    : profileLoading
      ? null
      : profileHasBirthData(profile);
  const { forecast, error, refresh, status, accessMode, modelUsed, userLocation, locationIssue, loading, homeTextsLoading } = useDayContent({
    locationErrorMessage: strings.locationErrorMessage,
    birthDataErrorMessage: strings.birthDataMessage,
    accessModeOverride: accessModeForTier(access.tier),
    accessTierOverride: access.tier,
    natalRequired: needsPersonalForecast,
    hasNatalProfile: hasBirthDataForForecast,
  });
  const forecastErrorAlert = useMemo(
    () =>
      error
        ? resolveUserFacingAlert(error, strings.locale, { genericTitle: strings.forecastErrorTitle })
        : null,
    [error, strings.forecastErrorTitle, strings.locale],
  );

  useEffect(() => {
    let cancelled = false;
    if (!profile?.id || !needsPersonalForecast) {
      setNatalProfile(null);
      return;
    }
    fetchActiveNatalProfileCached(profile.id, {
      expectedBirthFingerprint: birthFingerprint,
      onBackgroundRefresh: (value) => {
        if (!cancelled && value) setNatalProfile(value);
      },
    })
      .then((value) => {
        if (!cancelled) setNatalProfile(value);
      })
      .catch((loadError) => {
        console.warn("[Home] Failed to load active natal profile for chart UI", loadError);
      });
    return () => {
      cancelled = true;
    };
  }, [birthFingerprint, needsPersonalForecast, profile?.id]);

  // Reinforce tabs-level prefetch once Home shell is usable (disk + /api/day).
  // Primary kickoff is `app/(tabs)/_layout.tsx` so Day works even before Home ready.
  useEffect(() => {
    if (status !== "ready" && status !== "stale_ready") return;
    if (loading) return;
    if (!authUser?.id) return;
    ensureDayPlanPrefetch({
      userId: authUser.id,
      locale: appLocale,
      reason: "home_ready",
    });
  }, [appLocale, authUser?.id, loading, status]);

  useFocusEffect(
    useCallback(() => {
      const pending = consumeHomeDayContentBlockingReload();
      if (pending) {
        void refresh({
          forceRefresh: pending.forceRefresh,
          blockingReload: true,
        });
      }
      // Мягкий запрос уведомлений на Главной (cooldown / политика — в notifications).
      if (authUser?.id && Platform.OS !== "web") {
        void (async () => {
          const result = await ensureNotificationPermission("home");
          if (result === "granted") await registerPushToken(authUser.id);
        })();
      }
    }, [authUser?.id, refresh]),
  );

  const prevLocaleRef = useRef(appLocale);
  useEffect(() => {
    prevLocaleRef.current = appLocale;
  }, [appLocale]);

  const onSignOut = useCallback(async () => {
    await signOut();
  }, [signOut]);

  // Естественный выход из геогейта: на Android реально закрываем приложение;
  // на iOS Apple запрещает программный выход, поэтому выходим из аккаунта —
  // пользователь попадает на /sign-in и может закрыть приложение вручную.
  const onCloseAppFromGeoGate = useCallback(() => {
    logRuntimeEvent("home:geo_gate_close_app", { platform: Platform.OS });
    if (Platform.OS === "android") {
      BackHandler.exitApp();
      return;
    }
    void signOut();
  }, [signOut]);

  const onSaveNatalBridge = useCallback(
    async (birthData: BirthData, placeName: string) => {
      setNatalSaving(true);
      try {
        const result = await createNatalProfile(birthData, undefined, { placeName });
        setNatalProfile(result.profile);
        await refreshProfile();
        setNatalBridgeOpen(false);
        try {
          await refresh({ forceRefresh: true });
          Alert.alert("Готово", "Натальный профиль сохранён. Прогноз дня пересчитан в персональном режиме.");
        } catch (refreshError) {
          console.warn("[Home] Natal saved, but day refresh failed", refreshError);
          Alert.alert(
            "Натальный профиль сохранён",
            "Данные рождения обновились, но прогноз дня сейчас загружается дольше обычного. Если он не появится сам, нажмите «Повторить».",
          );
        }
      } catch (error) {
        const message = errorMessage(error, "Не удалось сохранить натальные данные.");
        Alert.alert("Ошибка сохранения", message);
      } finally {
        setNatalSaving(false);
      }
    },
    [refresh, refreshProfile],
  );

  const onDevResetDayContent = useCallback(async () => {
    setDevDayResetBusy(true);
    try {
      if (authUser?.id) {
        await clearHomeDailyDialogCache(authUser.id);
      }
      const resetScope: DevDayContentResetScope = "both";
      const resetResult = await postDevDayContentReset(resetScope);
      await refresh({ forceRefresh: true });
      setAssistantRemountKey((k) => k + 1);
      const deleted = resetResult?.deleted;
      const debugLine = deleted
        ? `\n\nСброшено: forecast=${deleted.user_daily_forecasts ?? 0}, monologue=${deleted.scenario_cache ?? 0}, global=${deleted.global_daily_content ?? 0}, dialogs=${deleted.open_home_conversations ?? 0}.`
        : "";
      Alert.alert("Готово", `Данные дня обновлены.${debugLine}`);
    } catch (error) {
      Alert.alert("Сброс", errorMessage(error));
    } finally {
      setDevDayResetBusy(false);
    }
  }, [access.tier, authUser?.id, refresh]);

  const dismissAssistantOpening = useCallback(() => {
    setAssistantOpening(false);
  }, []);

  // Safety net if dialog never paints assistant text (network hang).
  useEffect(() => {
    if (!assistantOpening) return;
    const timer = setTimeout(() => setAssistantOpening(false), 45_000);
    return () => clearTimeout(timer);
  }, [assistantOpening]);

  const onOpenAssistantOrDay = useCallback(async () => {
    if (!canUseFeature("assistant_dialog")) {
      setUpgradeFeature("assistant_dialog");
      return;
    }
    setAssistantOpening(true);
    try {
      if (canUseFeature("day_planning")) {
        // Prefer same-session prefetch/memory before a second /api/day wait.
        let dayPlan =
          peekPrefetchedDayPlan() ??
          (authUser?.id ? peekCachedDayPlan({ userId: authUser.id, locale: appLocale }) : null);
        if (!dayPlan || !isDayPlanCurrent(dayPlan)) {
          dayPlan = await loadDayPlan();
          storePrefetchedDayPlan(dayPlan);
        }
        if (!dayPlan.hasOverdueSummary && dayPlanHasVisibleContent(dayPlan)) {
          setHomeDayPractices([]);
          setHomeDayHealthContext(null);
          setAssistantOpening(false);
          router.push("/day");
          return;
        }
        if (dayPlan.hasOverdueSummary) {
          const summaryTargetLocalDate = dayPlan.summaryTargetLocalDate ?? dayPlan.currentLocalDate;
          const practices = dayPlan.sections.flatMap((section) =>
            section.practices.map((practice) => ({
              ...practice,
              title: dayPlan.sections.length > 1 ? `${section.localDate}: ${practice.title}` : practice.title,
            })),
          );
          setHomeDayPractices(practices);
          // Yoga-only signal: Communicator starts the single Apple/Google Health
          // collection at summarizing open (do not double-query from Home).
          setHomeDayHealthContext(buildSummarizingHealthSnapshot(summaryTargetLocalDate, practices));
          setHomeWorkingLocalDate(summaryTargetLocalDate);
          setHomeDayTimeZone(dayPlan.timezone);
        } else {
          setHomeDayPractices([]);
          setHomeDayHealthContext(null);
          setHomeWorkingLocalDate(null);
          setHomeDayTimeZone(null);
        }
      }
      setAssistantRemountKey((k) => k + 1);
      setCommunicatorDismissAnimation("slide");
      setCommunicatorMounted(true);
      setCommunicatorVisible(true);
      // Spinner stays until Communicator reports first visible assistant text.
    } catch (loadError) {
      console.warn("[Home] Failed to check day plan before assistant", loadError);
      setHomeDayPractices([]);
      setHomeDayHealthContext(null);
      setHomeWorkingLocalDate(null);
      setHomeDayTimeZone(null);
      setAssistantRemountKey((k) => k + 1);
      setCommunicatorDismissAnimation("slide");
      setCommunicatorMounted(true);
      setCommunicatorVisible(true);
    }
  }, [appLocale, authUser?.id, canUseFeature]);

  return (
    <GeoGate onCloseApp={onCloseAppFromGeoGate} onGranted={() => void refresh()}>
    <TabScreenLayout>
      <TabScrollView contentOptions={{ maxWidth: 460, bottomPaddingExtra: 32 }}>
        <HomeHeader forecast={forecast} strings={strings} homeTextsLoading={homeTextsLoading} />
        <UpcomingWebinarBanner />

        {loading && !forecast ? <HomeLoadingSkeleton text={strings.skeletonText} /> : null}

        {status === "need_location" && error ? (
          <HomeError
            title={strings.locationErrorTitle}
            message={resolveLocationErrorMessage(locationIssue, strings)}
            tone="warning"
            actionLabel={strings.retryButton}
            onAction={() => void refresh({ forceRefresh: true })}
            secondaryActionLabel={locationIssue === "permission_denied" ? strings.openSettingsButton : undefined}
            onSecondaryAction={
              locationIssue === "permission_denied" ? () => void Linking.openSettings() : undefined
            }
          />
        ) : null}
        {status === "need_birth_data" ? (
          <HomeError
            title={strings.birthDataTitle}
            message={strings.birthDataMessage}
            tone="warning"
            actionLabel={strings.enterBirthDataButton}
            onAction={() => setNatalBridgeOpen(true)}
          />
        ) : null}
        {status === "error" && error && forecastErrorAlert ? (
          <HomeError
            title={forecastErrorAlert.title}
            message={forecastErrorAlert.message}
            tone="danger"
            actionLabel={strings.retryButton}
            onAction={() => void refresh({ forceRefresh: true })}
          />
        ) : null}
        {status === "stale_ready" ? (
          <HomeStaleNotice title={strings.staleContentTitle} message={strings.staleContentMessage} />
        ) : null}
        {locationIssue && (status === "stale_ready" || status === "ready") ? (
          <HomeError
            title={strings.locationErrorTitle}
            message={resolveLocationErrorMessage(locationIssue, strings)}
            tone="warning"
            actionLabel={strings.retryButton}
            onAction={() => void refresh({ forceRefresh: true })}
            secondaryActionLabel={locationIssue === "permission_denied" ? strings.openSettingsButton : undefined}
            onSecondaryAction={
              locationIssue === "permission_denied" ? () => void Linking.openSettings() : undefined
            }
          />
        ) : null}

        {forecast ? (
          <>
            {access.tier === "free" && profile && !profileLoading ? <AccountUpsellPanel /> : null}
            <ChakraFlower
              forecast={forecast}
              strings={strings}
              accessMode={accessMode}
              natalProfile={natalProfile}
            />
            <DailyRecommendationCard
              forecast={forecast}
              strings={strings}
              onDiscuss={() => void onOpenAssistantOrDay()}
              showDiscuss
              accessMode={accessMode}
              natalProfile={natalProfile}
              modelUsed={modelUsed}
              homeTextsLoading={homeTextsLoading}
            />
            <OpportunityWindows
              planetOfTheDay={forecast.planetOfTheDay}
              forecastDate={forecast.date}
              windows={forecast.windowsOfOpportunity}
              strings={strings}
              accessMode={accessMode}
              userLocation={userLocation}
            />
            <LatestPostBanner />
          </>
        ) : (
          <LatestPostBanner />
        )}

        {status !== "need_birth_data" ? (
          <NatalBridgeCard
            label={strings.enterBirthDataButton}
            onOpen={() => {
              if (canUseFeature("calibration")) {
                setNatalBridgeOpen(true);
              } else {
                setUpgradeFeature("calibration");
              }
            }}
          />
        ) : null}
        {HARMONIZER_TEST_MODE ? (
          <AccessDevTierSwitch value={access.devOverride} onChange={setDevTierOverride} />
        ) : null}
        {HARMONIZER_TEST_MODE ? (
          <DevLinks
            strings={strings}
            leadingAccessory={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={strings.devResetDayContent}
                disabled={devDayResetBusy}
                onPress={() => void onDevResetDayContent()}
                style={({ pressed }) => [
                  styles.devPill,
                  {
                    borderColor: theme.colors.accent,
                    backgroundColor: theme.colors.controlButtonBg,
                    opacity: pressed || devDayResetBusy ? 0.55 : 1,
                    minWidth: 88,
                    alignItems: "center",
                    justifyContent: "center",
                  },
                ]}
              >
                {devDayResetBusy ? (
                  <ActivityIndicator size="small" color={theme.colors.accent} />
                ) : (
                  <AppText variant="technicalCaption">{strings.devResetDayContent}</AppText>
                )}
              </Pressable>
            }
          />
        ) : null}
        {HARMONIZER_TEST_MODE ? <DevLocalNotificationTestButton /> : null}
        <AppButton
          label={signingIn ? strings.signingOutButton : strings.signOutButton}
          variant="secondary"
          onPress={onSignOut}
          disabled={signingIn}
        />
      </TabScrollView>

      {communicatorMounted && forecast ? (
        <CommunicatorOverlay
          forecast={forecast}
          accessMode={accessMode}
          strings={strings}
          dayHealthContext={homeDayHealthContext}
          dayPractices={homeDayPractices}
          workingLocalDate={homeWorkingLocalDate}
          timeZone={homeDayTimeZone}
          remountKey={assistantRemountKey}
          visible={communicatorVisible}
          dismissAnimation={communicatorDismissAnimation}
          devAccessTierOverride={access.source === "dev_override" ? access.tier : null}
          onFirstAssistantVisible={dismissAssistantOpening}
          onDismiss={() => {
            dismissAssistantOpening();
            setCommunicatorMounted(false);
            setCommunicatorDismissAnimation("slide");
          }}
          onPracticeStarted={() => {
            dismissAssistantOpening();
            setHomeDayPractices([]);
            setHomeDayHealthContext(null);
            setHomeWorkingLocalDate(null);
            setHomeDayTimeZone(null);
            setCommunicatorDismissAnimation("none");
            setCommunicatorVisible(false);
            void loadDayPlan()
              .then(storePrefetchedDayPlan)
              .catch((error) => {
                console.warn("[Home] Failed to prefetch Day before practice", error);
              });
          }}
          onClose={() => {
            dismissAssistantOpening();
            setHomeDayPractices([]);
            setHomeDayHealthContext(null);
            setHomeWorkingLocalDate(null);
            setHomeDayTimeZone(null);
            // Navigate to Day FIRST so dismissing the modal reveals the Day tab
            // (not a flash of Home), and do NOT block navigation on the network
            // reload. Day content was pre-warmed via onMessage during the planning
            // final; this background reload is just a catch-up.
            router.push("/day");
            setCommunicatorDismissAnimation("slide");
            setCommunicatorVisible(false);
            void loadDayPlan()
              .then(storePrefetchedDayPlan)
              .catch((error) => {
                console.warn("[Home] Failed to prefetch Day after closing dialog", error);
              });
          }}
        />
      ) : null}
      <NatalBirthDataModal
        visible={natalBridgeOpen}
        saving={natalSaving}
        initialDate={profile?.birth_date}
        initialTime={profile?.birth_time}
        initialPlace={profile?.birth_place}
        onClose={() => setNatalBridgeOpen(false)}
        onSubmit={onSaveNatalBridge}
      />
      {upgradeFeature ? (
        <AccountGateDialog
          visible
          feature={upgradeFeature}
          onClose={() => setUpgradeFeature(null)}
        />
      ) : null}
      <BlockingStatusToast visible={assistantOpening} />
    </TabScreenLayout>
    </GeoGate>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  content: {
    alignSelf: "center",
    gap: 18,
    maxWidth: 460,
    paddingHorizontal: 20,
    width: "100%",
  },
  header: {
    gap: 12,
  },
  heroRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
  },
  headerText: {
    flex: 1,
    gap: 8,
  },
  stateCard: {
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 24,
    gap: 12,
    padding: 20,
  },
  centerText: {
    textAlign: "center",
  },
  devLinks: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
    paddingTop: 4,
  },
  tierSwitch: {
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 18,
    gap: 10,
    padding: 12,
  },
  tierSwitchActions: {
    flexDirection: "row",
    gap: 8,
  },
  tierSwitchLink: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  devPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  overlayRoot: {
    flex: 1,
  },
  overlayHeader: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 10,
    paddingHorizontal: 16,
  },
  closeButton: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
