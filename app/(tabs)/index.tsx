import { useAuth } from "@/modules/auth";
import type { BirthData, NatalProfile } from "@/modules/astro-core";
import type { CommunicatorHistoryMessage } from "@/modules/communicator/core/types";
import { Communicator } from "@/modules/communicator/ui/Communicator";
import type { DailyForecast } from "@/modules/daily-engine";
import { getHomeStrings, type HomeStrings } from "@/modules/home/i18n/home";
import { useDayContent } from "@/modules/home/useDayContent";
import { ChakraFlower } from "@/modules/home/ui/ChakraFlower";
import { DailyRecommendationCard } from "@/modules/home/ui/DailyRecommendationCard";
import { OpportunityWindows } from "@/modules/home/ui/OpportunityWindows";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { createNatalProfile, fetchActiveNatalProfile } from "@/services/natalProfileClient";
import { requireSupabase } from "@/services/supabase";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const MOSCOW_BIRTH_LOCATION: BirthData["location"] = {
  lat: 55.7558,
  lng: 37.6173,
  timezone: "Europe/Moscow",
};

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
            {strings.daySlogan(forecast)}
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

function DevLinks({ strings }: { strings: HomeStrings }) {
  const theme = useTheme();
  const links = [
    { label: strings.devLinks.biofeedback, href: "/biofeedback-probe" },
    { label: strings.devLinks.mandala, href: "/mandala-sandbox" },
    { label: strings.devLinks.bindu, href: "/bindu-succession-lab" },
    { label: strings.devLinks.symbols, href: "/sacred-symbol-stream" },
    { label: strings.devLinks.breath, href: "/breath-coherence" },
    { label: strings.devLinks.calibration, href: "/calibration" },
  ];

  return (
    <View style={styles.devLinks}>
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

function DevTierSwitch({
  accessMode,
  switching,
  onSetFree,
  onSetPremium,
}: {
  accessMode: "free" | "trial" | "premium";
  switching: boolean;
  onSetFree: () => void;
  onSetPremium: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.tierSwitch, { borderColor: theme.colors.surfaceBorder }]}>
      <AppText variant="technicalCaption" tone="muted">
        Тест тарифа: {accessMode === "premium" ? "платный" : accessMode === "trial" ? "триал" : "бесплатный"}
      </AppText>
      <View style={styles.tierSwitchActions}>
        <Pressable
          accessibilityRole="button"
          disabled={switching}
          onPress={onSetFree}
          style={({ pressed }) => [
            styles.tierSwitchLink,
            { opacity: pressed || switching ? 0.55 : 1, borderColor: theme.colors.surfaceBorder },
          ]}
        >
          <AppText variant="technicalCaption">Бесплатный</AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={switching}
          onPress={onSetPremium}
          style={({ pressed }) => [
            styles.tierSwitchLink,
            { opacity: pressed || switching ? 0.55 : 1, borderColor: theme.colors.surfaceBorder },
          ]}
        >
          <AppText variant="technicalCaption">Платный</AppText>
        </Pressable>
      </View>
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

function CommunicatorOverlay({
  forecast,
  strings,
  onClose,
}: {
  forecast: DailyForecast;
  strings: HomeStrings;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const initialAssistantMessage = useMemo<CommunicatorHistoryMessage>(() => {
    const hour = new Date().getHours();
    const greeting = hour >= 5 && hour < 11 ? "Доброе утро" : hour >= 11 && hour < 17 ? "Добрый день" : hour >= 17 && hour < 22 ? "Добрый вечер" : "Доброй ночи";
    const meta = forecast.planetOfTheDay;
    const tone = strings.toneLabels[forecast.todayPlanetState.todayTone];
    return {
      id: `daily-opening-${forecast.date}-${forecast.planetOfTheDay}`,
      role: "assistant",
      createdAt: Date.now(),
      content: `${greeting}. Сегодня главная тема дня связана с ${strings.planetLabels[meta].toLowerCase()} и состоянием «${strings.daySlogan(forecast)}». Тональность дня: ${tone}. Расскажи, что сейчас с тобой: больше нужна ясность, энергия, спокойствие, отношения, тело или внутренние границы? Можно ответить голосом.`,
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
          key={`${forecast.date}-${forecast.planetOfTheDay}`}
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
        />
      </View>
    </Modal>
  );
}

export default function HomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { profile, signOut, signingIn, refreshProfile } = useAuth();
  const strings = useMemo(
    () => getHomeStrings(profile?.locale === "en" ? "en" : "ru"),
    [profile?.locale],
  );
  const { forecast, loading, error, refresh, status, accessMode } = useDayContent({
    locationErrorMessage: strings.locationErrorMessage,
  });
  const [communicatorOpen, setCommunicatorOpen] = useState(false);
  const [natalBridgeOpen, setNatalBridgeOpen] = useState(false);
  const [natalSaving, setNatalSaving] = useState(false);
  const [tierSwitching, setTierSwitching] = useState(false);
  const [natalProfile, setNatalProfile] = useState<NatalProfile | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!profile?.id || accessMode === "free") {
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
  }, [accessMode, profile?.id]);

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
        const message = error instanceof Error ? error.message : "Не удалось сохранить натальные данные.";
        Alert.alert("Ошибка сохранения", message);
      } finally {
        setNatalSaving(false);
      }
    },
    [refresh, refreshProfile],
  );

  const switchTier = useCallback(
    async (mode: "free" | "premium") => {
      if (!profile?.id) return;
      setTierSwitching(true);
      try {
        const update =
          mode === "premium"
            ? { membership_tier: "premium", trial_expires_at: null }
            : { membership_tier: "free", trial_expires_at: new Date(Date.now() - 60_000).toISOString() };
        const { error } = await requireSupabase().from("users").update(update).eq("id", profile.id);
        if (error) throw error;
        await refreshProfile();
        await refresh({ forceRefresh: true });
      } catch (error) {
        Alert.alert("Не удалось переключить тариф", error instanceof Error ? error.message : String(error));
      } finally {
        setTierSwitching(false);
      }
    },
    [profile?.id, refresh, refreshProfile],
  );

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
            {accessMode === "free" ? <FreeTierBanner /> : null}
            <ChakraFlower forecast={forecast} strings={strings} />
            <DailyRecommendationCard
              forecast={forecast}
              strings={strings}
              onDiscuss={() => setCommunicatorOpen(true)}
              showDiscuss={accessMode !== "free"}
              accessMode={accessMode}
              natalProfile={natalProfile}
            />
            <OpportunityWindows
              planetOfTheDay={forecast.planetOfTheDay}
              windows={forecast.windowsOfOpportunity}
              strings={strings}
            />
          </>
        ) : null}

        <NatalBridgeCard onOpen={() => setNatalBridgeOpen(true)} />
        {__DEV__ ? (
          <DevTierSwitch
            accessMode={accessMode}
            switching={tierSwitching}
            onSetFree={() => void switchTier("free")}
            onSetPremium={() => void switchTier("premium")}
          />
        ) : null}
        <DevLinks strings={strings} />
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
          strings={strings}
          onClose={() => setCommunicatorOpen(false)}
        />
      ) : null}
      <NatalBridgeModal
        visible={natalBridgeOpen}
        saving={natalSaving}
        onClose={() => setNatalBridgeOpen(false)}
        onSubmit={onSaveNatalBridge}
      />
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
