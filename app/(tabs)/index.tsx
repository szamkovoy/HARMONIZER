import { useAuth } from "@/modules/auth";
import { DevTierSwitch as AccessDevTierSwitch, UpgradeDialog, accessModeForTier, requiredTierFor, useAccess, type FeatureKey } from "@/modules/access";
import type { BirthData, NatalProfile } from "@/modules/astro-core";
import type { CommunicatorHistoryMessage } from "@/modules/communicator/core/types";
import { Communicator } from "@/modules/communicator/ui/Communicator";
import type { DailyForecast } from "@/modules/daily-engine";
import { getHomeStrings, type HomeStrings } from "@/modules/home/i18n/home";
import { useDayContent } from "@/modules/home/useDayContent";
import { ChakraFlower } from "@/modules/home/ui/ChakraFlower";
import { DailyRecommendationCard } from "@/modules/home/ui/DailyRecommendationCard";
import { OpportunityWindows } from "@/modules/home/ui/OpportunityWindows";
import { launchPractice } from "@/modules/practices/ui/launchPractice";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { HARMONIZER_TEST_MODE } from "@/modules/ui/testMode";
import { useTheme } from "@/modules/ui/theme";
import { postGlobalContentDevReset } from "@/services/devDayContentResetClient";
import { createNatalProfile, fetchActiveNatalProfile } from "@/services/natalProfileClient";
import { requireSupabase } from "@/services/supabase";
import type { PracticePicked } from "@/services/communicator-client";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const MOSCOW_BIRTH_LOCATION: BirthData["location"] = {
  lat: 55.7558,
  lng: 37.6173,
  timezone: "Europe/Moscow",
};

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
          <AppText variant="screenHint" tone="muted">
            {forecast?.slogan?.trim() || strings.daySlogan(forecast)}
          </AppText>
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

function HomeSkeleton({ strings }: { strings: HomeStrings }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.stateCard,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.surfaceBorder,
        },
      ]}
    >
      <ActivityIndicator color={theme.colors.accent} />
      <AppText variant="screenHint" tone="muted" style={styles.centerText}>
        {strings.skeletonText}
      </AppText>
    </View>
  );
}

function HomeError({
  message,
  missingLocation,
  onRetry,
  strings,
}: {
  message: string;
  missingLocation: boolean;
  onRetry: () => void;
  strings: HomeStrings;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.stateCard,
        {
          backgroundColor: theme.colors.surface,
          borderColor: missingLocation ? theme.colors.warning : theme.colors.danger,
        },
      ]}
    >
      <AppText variant="sectionTitle" tone={missingLocation ? "warning" : "danger"} style={styles.centerText}>
        {missingLocation ? strings.locationErrorTitle : strings.forecastErrorTitle}
      </AppText>
      <AppText variant="screenHint" tone="muted" style={styles.centerText}>
        {message}
      </AppText>
      {!missingLocation ? <AppButton label={strings.retryButton} variant="secondary" onPress={onRetry} /> : null}
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
  return <AppButton label="Ввести натальные данные" variant="secondary" onPress={onOpen} />;
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

function NatalBridgeModal({
  visible,
  saving,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  saving: boolean;
  onClose: () => void;
  onSubmit: (birthData: BirthData) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");

  const submit = useCallback(() => {
    const normalizedDate = date.trim();
    const normalizedTime = time.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
      Alert.alert("Проверьте дату", "Введите дату в формате YYYY-MM-DD.");
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(normalizedTime)) {
      Alert.alert("Проверьте время", "Введите время в формате HH:MM.");
      return;
    }

    void onSubmit({
      date: normalizedDate,
      time: normalizedTime,
      timeMode: "precise",
      location: MOSCOW_BIRTH_LOCATION,
    });
  }, [date, onSubmit, time]);

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View
          style={[
            styles.modalCard,
            {
              backgroundColor: theme.colors.screenBg,
              borderColor: theme.colors.surfaceBorder,
              paddingBottom: insets.bottom + 18,
            },
          ]}
        >
          <AppText variant="sectionTitle">Натальные данные</AppText>
          <AppText variant="screenHint" tone="muted">
            Это временный технический ввод для M1. Место рождения пока фиксировано: Москва, Europe/Moscow.
          </AppText>
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={theme.colors.textFaint}
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
            editable={!saving}
            style={[
              styles.input,
              {
                borderColor: theme.colors.surfaceBorder,
                color: theme.colors.textPrimary,
              },
            ]}
          />
          <TextInput
            value={time}
            onChangeText={setTime}
            placeholder="HH:MM"
            placeholderTextColor={theme.colors.textFaint}
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
            editable={!saving}
            style={[
              styles.input,
              {
                borderColor: theme.colors.surfaceBorder,
                color: theme.colors.textPrimary,
              },
            ]}
          />
          <View style={styles.modalActions}>
            <AppButton label="Отмена" variant="secondary" onPress={onClose} disabled={saving} />
            <AppButton label={saving ? "Сохраняю..." : "Сохранить"} onPress={submit} disabled={saving} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function launchPracticeFromAssistant(practice: PracticePicked, onClose: () => void) {
  onClose();
  if (launchPractice(practice.launch, { launchSource: "assistant" })) return;
  if (practice.kind === "breath") {
    launchPractice({
      route: "/breath-coherence",
      params: {
        practiceId: practice.slug ?? practice.id,
        durationMs: String((practice.durationSec ?? 600) * 1000),
        chakra: String(practice.chakraIds?.[0] ?? 4),
      },
    }, { launchSource: "assistant" });
    return;
  }
  if (practice.kind === "yoga") {
    launchPractice({
      route: "/asana-practice",
      params: {
        practiceId: practice.id,
        ...(practice.durationSec ? { durationMs: String(practice.durationSec * 1000) } : {}),
        ...(practice.chakraIds?.[0] ? { chakra: String(practice.chakraIds[0]) } : {}),
      },
    }, { launchSource: "assistant" });
    return;
  }
  launchPractice({ route: "/sacred-symbol-stream", params: {} }, { launchSource: "assistant" });
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
  const initialAssistantMessage = useMemo<CommunicatorHistoryMessage>(() => {
    const hour = new Date().getHours();
    const greeting = hour >= 5 && hour < 11 ? "Доброе утро" : hour >= 11 && hour < 17 ? "Добрый день" : hour >= 17 && hour < 22 ? "Добрый вечер" : "Доброй ночи";
    const headline = forecast.slogan?.trim() || strings.daySlogan(forecast);
    const tone = strings.toneLabels[forecast.todayPlanetState.todayTone];
    const recommendation = forecast.recommendationShortText?.trim();
    return {
      id: `daily-opening-${forecast.date}-${forecast.planetOfTheDay}`,
      role: "assistant",
      createdAt: Date.now(),
      content: recommendation
        ? `${greeting}. Сегодняшний фокус: «${headline}». Тон дня ${tone}; рекомендация уже есть, а здесь можно перевести её в живую ситуацию, без технического языка. Где это сейчас сильнее отзывается — в теле, в голове или в разговоре, который назревает?`
        : `${greeting}. Сегодняшний фокус: «${headline}». Давай разберём его через живую ситуацию. Где сейчас больше всего напряжения — в теле, в голове или в общении?`,
      meta: {
        orchestratorDecision: {
          next_phase: "contextual_greeting",
          reasoning: "Client-side opening based on daily forecast context.",
          information_completeness: {},
          information_density: 0,
          user_signals: [],
          should_close: false,
          decision_source: "bypass_greeting",
        },
      },
    };
  }, [forecast, strings]);
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
            todayTone: forecast.todayPlanetState.todayTone,
            windowsOfOpportunity: forecast.windowsOfOpportunity,
          }}
          history={[initialAssistantMessage]}
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
  const strings = useMemo(
    () => getHomeStrings(profile?.locale === "en" ? "en" : "ru"),
    [profile?.locale],
  );
  const { forecast, loading, error, refresh, status, accessMode, modelUsed } = useDayContent({
    locationErrorMessage: strings.locationErrorMessage,
    accessModeOverride: accessModeForTier(access.tier),
    accessTierOverride: access.tier,
  });
  const [communicatorOpen, setCommunicatorOpen] = useState(false);
  const [natalBridgeOpen, setNatalBridgeOpen] = useState(false);
  const [natalSaving, setNatalSaving] = useState(false);
  const [devDayResetBusy, setDevDayResetBusy] = useState(false);
  const [assistantRemountKey, setAssistantRemountKey] = useState(0);
  const [natalProfile, setNatalProfile] = useState<NatalProfile | null>(null);
  const [upgradeFeature, setUpgradeFeature] = useState<FeatureKey | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!profile?.id || !canUseFeature("personal_daily_forecast")) {
      setNatalProfile(null);
      return;
    }
    fetchActiveNatalProfile()
      .then((value) => {
        if (!cancelled) setNatalProfile(value);
      })
      .catch((error) => {
        console.warn("[Home] Failed to load active natal profile", error);
        if (!cancelled) setNatalProfile(null);
      });
    return () => {
      cancelled = true;
    };
  }, [canUseFeature, profile?.id]);

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

        {loading ? <HomeSkeleton strings={strings} /> : null}
        {error ? (
          <HomeError
            message={error.message}
            missingLocation={status === "missing_location"}
            onRetry={() => void refresh({ forceRefresh: true })}
            strings={strings}
          />
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
              windows={forecast.windowsOfOpportunity}
              strings={strings}
              accessMode={accessMode}
            />
          </>
        ) : null}

        <NatalBridgeCard
          onOpen={() => {
            if (canUseFeature("calibration")) {
              setNatalBridgeOpen(true);
            } else {
              setUpgradeFeature("calibration");
            }
          }}
        />
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
      <NatalBridgeModal
        visible={natalBridgeOpen}
        saving={natalSaving}
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
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  modalCard: {
    borderTopWidth: 1,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    gap: 14,
    padding: 18,
  },
  input: {
    borderWidth: 1,
    borderRadius: 16,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end",
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
