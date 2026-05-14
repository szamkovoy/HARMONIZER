import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/modules/auth";
import { DevTierSwitch as AccessDevTierSwitch, UpgradeDialog, accessModeForTier, requiredTierFor, useAccess, type FeatureKey } from "@/modules/access";
import type { BirthData, NatalProfile } from "@/modules/astro-core";
import { Communicator } from "@/modules/communicator/ui/Communicator";
import type { DailyForecast } from "@/modules/daily-engine";
import { getHomeStrings, type HomeStrings } from "@/modules/home/i18n/home";
import { PLANET_CHAKRA } from "@/modules/home/planetChakra";
import { useDayContent } from "@/modules/home/useDayContent";
import { NatalBirthDataModal } from "@/modules/home/ui/NatalBirthDataModal";
import { ChakraFlower } from "@/modules/home/ui/ChakraFlower";
import { DailyRecommendationCard } from "@/modules/home/ui/DailyRecommendationCard";
import { OpportunityWindows } from "@/modules/home/ui/OpportunityWindows";
import { launchPractice } from "@/modules/practices/ui/launchPractice";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { HARMONIZER_TEST_MODE } from "@/modules/ui/testMode";
import { useTheme } from "@/modules/ui/theme";
import { postGlobalContentDevReset } from "@/services/devDayContentResetClient";
import {
  buildOpportunityAlarmStyleContent,
  getExpoNotificationsOrNull,
  OPPORTUNITY_REMINDERS_CHANNEL_ID,
} from "@/services/localNotifications";
import { consumeHomeDayContentBlockingReload } from "@/services/homeDayContentReloadRequest";
import { createNatalProfile, fetchActiveNatalProfileCached } from "@/services/natalProfileClient";
import { requireSupabase } from "@/services/supabase";
import type { PracticePicked } from "@/services/communicator-client";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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

function HomeHeader({
  forecast,
  strings,
}: {
  forecast: DailyForecast | null;
  strings: HomeStrings;
}) {
  const today = new Intl.DateTimeFormat(strings.locale === "ru" ? "ru" : "en", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
  return (
    <View style={styles.header}>
      <View style={styles.heroRow}>
        <View style={styles.avatarRing}>
          <Image source={require("@/assets/icons/apple-touch-icon.png")} style={styles.avatar} resizeMode="cover" />
        </View>
        <View style={styles.headerText}>
          <AppText variant="screenHint" accessibilityRole="header" style={styles.dateText}>
            {today}
          </AppText>
          {forecast?.slogan?.trim() ? (
            <AppText variant="screenHint" tone="muted">
              {forecast.slogan.trim()}
            </AppText>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function AnnouncementBanner() {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.announcement,
        {
          backgroundColor: theme.colors.controlButtonBg,
          borderColor: theme.colors.surfaceBorder,
          opacity: pressed ? 0.72 : 1,
        },
      ]}
    >
      <View style={[styles.announcementDot, { backgroundColor: theme.colors.accent }]} />
      <AppText variant="technicalCaption" tone="muted" style={styles.announcementText}>
        21.04 · 19:00 МСК - вебинар
      </AppText>
      <AppText variant="sectionTitle" tone="muted" style={styles.announcementArrow}>
        ›
      </AppText>
    </Pressable>
  );
}

function HomeError({
  title,
  message,
  tone,
  actionLabel,
  onAction,
}: {
  title: string;
  message: string;
  tone: "warning" | "danger";
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.stateCard,
        {
          backgroundColor: theme.colors.surface,
          borderColor: tone === "warning" ? theme.colors.warning : theme.colors.danger,
        },
      ]}
    >
      <AppText variant="sectionTitle" tone={tone} style={styles.centerText}>
        {title}
      </AppText>
      <AppText variant="screenHint" tone="muted" style={styles.centerText}>
        {message}
      </AppText>
      {actionLabel && onAction ? <AppButton label={actionLabel} variant="secondary" onPress={onAction} /> : null}
    </View>
  );
}

function HomeStaleNotice({ title, message }: { title: string; message: string }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.stateCard,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.warning,
        },
      ]}
    >
      <AppText variant="sectionTitle" tone="warning" style={styles.centerText}>
        {title}
      </AppText>
      <AppText variant="screenHint" tone="muted" style={styles.centerText}>
        {message}
      </AppText>
    </View>
  );
}

/** Только __DEV__: проверка `expo-notifications` без ожидания окна возможностей. */
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

function NatalBridgeCard({ onOpen }: { onOpen: () => void }) {
  return <AppButton label="Введите дату рождения" variant="secondary" onPress={onOpen} />;
}

function FreeTierBanner() {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.freeTierBanner,
        {
          backgroundColor: theme.colors.controlButtonBg,
          borderColor: theme.colors.warning,
        },
      ]}
    >
      <AppText variant="screenHint">
        Внизу вы видите универсальный прогноз на этот день. Конечно, индивидуальные прогнозы, опирающиеся на вашу дату
        рождения, гораздо точнее. Перейдите на платный тариф, чтобы их получать.
      </AppText>
    </View>
  );
}

function launchPracticeFromAssistant(practice: PracticePicked, onClose: () => void) {
  onClose();
}

function CommunicatorOverlay({
  forecast,
  accessMode,
  strings,
  onClose,
  remountKey,
}: {
  forecast: DailyForecast;
  accessMode: "free" | "premium" | "trial";
  strings: HomeStrings;
  onClose: () => void;
  remountKey: number;
}) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  return (
    <Modal animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.overlayRoot}>
        <View
          style={[
            styles.overlayHeader,
            {
              paddingTop: insets.top + 10,
              backgroundColor: theme.colors.screenBg,
              borderBottomColor: theme.colors.surfaceBorder,
            },
          ]}
        >
          <AppText variant="sectionTitle">{strings.assistantTitle}</AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={strings.closeAssistantAccessibilityLabel}
            onPress={onClose}
            style={({ pressed }) => [
              styles.closeButton,
              {
                backgroundColor: theme.colors.controlButtonBg,
                opacity: pressed ? 0.72 : 1,
              },
            ]}
          >
            <AppText variant="buttonLabel">{strings.closeButton}</AppText>
          </Pressable>
        </View>
        <Communicator
          key={`${accessMode}-${forecast.date}-${forecast.planetOfTheDay}-${forecast.computedAt}-${remountKey}`}
          systemPrompt={strings.defaultSystemPrompt}
          locale={strings.locale}
          useCase="daily_dialog"
          entrySource="home"
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
          }}
          memoryWindow={24}
          onPracticePicked={(practice) => launchPracticeFromAssistant(practice, onClose)}
        />
      </View>
    </Modal>
  );
}

export default function HomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { profile, signOut, signingIn, refreshProfile } = useAuth();
  const { access, canUseFeature, setDevTierOverride } = useAccess();
  const needsPersonalForecast = canUseFeature("personal_daily_forecast");
  const strings = useMemo(
    () => getHomeStrings(profile?.locale === "en" ? "en" : "ru"),
    [profile?.locale],
  );
  const [communicatorOpen, setCommunicatorOpen] = useState(false);
  const [natalBridgeOpen, setNatalBridgeOpen] = useState(false);
  const [natalSaving, setNatalSaving] = useState(false);
  const [devDayResetBusy, setDevDayResetBusy] = useState(false);
  const [assistantRemountKey, setAssistantRemountKey] = useState(0);
  const [natalProfile, setNatalProfile] = useState<NatalProfile | null>(null);
  const [natalProfileLoading, setNatalProfileLoading] = useState(needsPersonalForecast);
  const [natalProfileResolved, setNatalProfileResolved] = useState(!needsPersonalForecast);
  const [upgradeFeature, setUpgradeFeature] = useState<FeatureKey | null>(null);
  const hasNatalProfile = needsPersonalForecast ? (natalProfileResolved ? Boolean(natalProfile) : null) : true;
  const { forecast, error, refresh, status, accessMode, modelUsed } = useDayContent({
    locationErrorMessage: strings.locationErrorMessage,
    birthDataErrorMessage: strings.birthDataMessage,
    accessModeOverride: accessModeForTier(access.tier),
    accessTierOverride: access.tier,
    natalRequired: needsPersonalForecast,
    hasNatalProfile,
  });

  useLayoutEffect(() => {
    if (!profile?.id || !needsPersonalForecast) {
      return;
    }
    setNatalProfileLoading(true);
    setNatalProfileResolved(false);
  }, [needsPersonalForecast, profile?.id, profile?.birth_date, profile?.birth_time]);

  useEffect(() => {
    let cancelled = false;
    if (!profile?.id || !needsPersonalForecast) {
      setNatalProfile(null);
      setNatalProfileLoading(false);
      setNatalProfileResolved(true);
      return;
    }
    setNatalProfileLoading(true);
    setNatalProfileResolved(false);
    fetchActiveNatalProfileCached(profile.id)
      .then((value) => {
        if (!cancelled) {
          setNatalProfile(value);
          setNatalProfileLoading(false);
          setNatalProfileResolved(true);
        }
      })
      .catch((loadError) => {
        console.warn("[Home] Failed to load active natal profile", loadError);
        if (!cancelled) {
          setNatalProfile(null);
          setNatalProfileLoading(false);
          setNatalProfileResolved(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [needsPersonalForecast, profile?.id, profile?.birth_date, profile?.birth_time]);

  useFocusEffect(
    useCallback(() => {
      const pending = consumeHomeDayContentBlockingReload();
      if (!pending) return;
      void refresh({
        forceRefresh: pending.forceRefresh,
        blockingReload: true,
      });
    }, [refresh]),
  );

  const onSignOut = useCallback(async () => {
    // AuthProvider: await supabase.auth.signOut() + signOutGoogle при необходимости.
    await signOut();
  }, [signOut]);

  const onSaveNatalBridge = useCallback(
    async (birthData: BirthData) => {
      setNatalSaving(true);
      try {
        const result = await createNatalProfile(birthData);
        setNatalProfile(result.profile);
        await refreshProfile();
        await refresh({ forceRefresh: true });
        setNatalBridgeOpen(false);
        Alert.alert("Готово", "Натальный профиль сохранён. Прогноз дня пересчитан в персональном режиме.");
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
      const resetResult = await postGlobalContentDevReset();
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
  }, [refresh]);

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.screenBg }]}>
      <StatusBar style={theme.scheme === "dark" ? "light" : "dark"} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + 20,
            paddingBottom: insets.bottom + 32,
          },
        ]}
      >
        <HomeHeader forecast={forecast} strings={strings} />
        <AnnouncementBanner />

        {status === "need_location" && error ? (
          <HomeError
            title={strings.locationErrorTitle}
            message={error.message}
            tone="warning"
            actionLabel={strings.retryButton}
            onAction={() => void refresh({ forceRefresh: true })}
          />
        ) : null}
        {status === "need_birth_data" ? (
          <HomeError
            title={strings.birthDataTitle}
            message={strings.birthDataMessage}
            tone="warning"
            actionLabel="Введите дату рождения"
            onAction={() => setNatalBridgeOpen(true)}
          />
        ) : null}
        {status === "error" && error ? (
          <HomeError
            title={strings.forecastErrorTitle}
            message={error.message}
            tone="danger"
            actionLabel={strings.retryButton}
            onAction={() => void refresh({ forceRefresh: true })}
          />
        ) : null}
        {status === "stale_ready" ? (
          <HomeStaleNotice title={strings.staleContentTitle} message={strings.staleContentMessage} />
        ) : null}

        {forecast ? (
          <>
            {access.tier === "free" ? <FreeTierBanner /> : null}
            <ChakraFlower forecast={forecast} strings={strings} />
            <DailyRecommendationCard
              forecast={forecast}
              strings={strings}
              onDiscuss={() => {
                if (canUseFeature("assistant_dialog")) {
                  setCommunicatorOpen(true);
                } else {
                  setUpgradeFeature("assistant_dialog");
                }
              }}
              showDiscuss
              accessMode={accessMode}
              natalProfile={natalProfile}
              modelUsed={modelUsed}
            />
            <OpportunityWindows
              planetOfTheDay={forecast.planetOfTheDay}
              forecastDate={forecast.date}
              windows={forecast.windowsOfOpportunity}
              strings={strings}
              accessMode={accessMode}
            />
          </>
        ) : null}

        {status !== "need_birth_data" ? (
          <NatalBridgeCard
            onOpen={() => {
              if (canUseFeature("calibration")) {
                setNatalBridgeOpen(true);
              } else {
                setUpgradeFeature("calibration");
              }
            }}
          />
        ) : null}
        {__DEV__ ? <AccessDevTierSwitch value={access.devOverride} onChange={setDevTierOverride} /> : null}
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
        {__DEV__ ? <DevLocalNotificationTestButton /> : null}
        <AppButton
          label={signingIn ? strings.signingOutButton : strings.signOutButton}
          variant="secondary"
          onPress={onSignOut}
          disabled={signingIn}
        />
      </ScrollView>

      {communicatorOpen && forecast ? (
        <CommunicatorOverlay
          forecast={forecast}
          accessMode={accessMode}
          strings={strings}
          remountKey={assistantRemountKey}
          onClose={() => setCommunicatorOpen(false)}
        />
      ) : null}
      <NatalBirthDataModal
        visible={natalBridgeOpen}
        saving={natalSaving}
        initialDate={profile?.birth_date}
        initialTime={profile?.birth_time}
        onClose={() => setNatalBridgeOpen(false)}
        onSubmit={onSaveNatalBridge}
      />
      {upgradeFeature ? (
        <UpgradeDialog
          visible
          feature={upgradeFeature}
          requiredTier={requiredTierFor(upgradeFeature)}
          onClose={() => setUpgradeFeature(null)}
        />
      ) : null}
    </View>
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
  avatarRing: {
    alignItems: "center",
    borderColor: "#9B5BEB",
    borderRadius: 999,
    borderWidth: 2,
    height: 58,
    justifyContent: "center",
    width: 58,
  },
  avatar: {
    borderRadius: 999,
    height: 50,
    width: 50,
  },
  headerText: {
    flex: 1,
    gap: 8,
  },
  dateText: {
    fontWeight: "700",
    textTransform: "capitalize",
  },
  announcement: {
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 40,
    paddingHorizontal: 14,
  },
  announcementDot: {
    borderRadius: 999,
    height: 7,
    opacity: 0.8,
    width: 7,
  },
  announcementText: {
    flex: 1,
    fontWeight: "600",
  },
  announcementArrow: {
    fontSize: 24,
    lineHeight: 24,
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
  freeTierBanner: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
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
