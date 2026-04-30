import { useAuth } from "@/modules/auth";
import type { BirthData } from "@/modules/astro-core";
import { Communicator } from "@/modules/communicator/ui/Communicator";
import type { DailyForecast } from "@/modules/daily-engine";
import { useDailyForecast } from "@/modules/daily-engine/ui/useDailyForecast";
import { getHomeStrings, type HomeStrings } from "@/modules/home/i18n/home";
import { ChakraFlower } from "@/modules/home/ui/ChakraFlower";
import { DailyRecommendationCard } from "@/modules/home/ui/DailyRecommendationCard";
import { EventBells } from "@/modules/home/ui/EventBells";
import { OpportunityWindows } from "@/modules/home/ui/OpportunityWindows";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { createNatalProfile } from "@/services/natalProfileClient";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type ForecastSource = "cache" | "computed";

const MOSCOW_BIRTH_LOCATION: BirthData["location"] = {
  lat: 55.7558,
  lng: 37.6173,
  timezone: "Europe/Moscow",
};

function HomeHeader({
  loading,
  source,
  onRefresh,
  forecast,
  strings,
}: {
  loading: boolean;
  source: ForecastSource | null;
  onRefresh: () => void;
  forecast: DailyForecast | null;
  strings: HomeStrings;
}) {
  const theme = useTheme();
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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings.refreshAccessibilityLabel}
        onPress={onRefresh}
        disabled={loading}
        style={({ pressed }) => [
          styles.refresh,
          {
            borderColor: theme.colors.surfaceBorder,
            opacity: loading ? 0.45 : pressed ? 0.72 : 1,
          },
        ]}
      >
        <AppText variant="statPillLabel">
          {loading ? strings.refreshingLabel : strings.refreshButton}
        </AppText>
      </Pressable>
      {source ? (
        <AppText variant="technicalCaption" tone="faint">
          {strings.sourceLabel(source)}
        </AppText>
      ) : null}
    </View>
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
  const theme = useTheme();
  return (
    <View
      style={[
        styles.natalBridgeCard,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.surfaceBorder,
        },
      ]}
    >
      <View style={styles.natalBridgeText}>
        <AppText variant="sectionTitle">Тестовый ввод M1</AppText>
        <AppText variant="screenHint" tone="muted">
          Временный мост: дата и время рождения, место рождения зафиксировано как Москва.
        </AppText>
      </View>
      <AppButton label="Ввести натальные данные" variant="secondary" onPress={onOpen} />
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
            forecastDate: forecast.date,
            planetOfTheDay: forecast.planetOfTheDay,
            todayTone: forecast.todayPlanetState.todayTone,
            windowsOfOpportunity: forecast.windowsOfOpportunity,
          }}
          memoryWindow={24}
          autoSendInitialMessage={strings.discussInitialMessage(forecast)}
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
  const { forecast, loading, error, refresh, source, status } = useDailyForecast({
    locationErrorMessage: strings.locationErrorMessage,
  });
  const [communicatorOpen, setCommunicatorOpen] = useState(false);
  const [natalBridgeOpen, setNatalBridgeOpen] = useState(false);
  const [natalSaving, setNatalSaving] = useState(false);

  const onSignOut = useCallback(async () => {
    // AuthProvider: await supabase.auth.signOut() + signOutGoogle при необходимости.
    await signOut();
  }, [signOut]);

  const onRefresh = useCallback(() => {
    void refresh({ forceRefresh: true });
  }, [refresh]);

  const onSaveNatalBridge = useCallback(
    async (birthData: BirthData) => {
      setNatalSaving(true);
      try {
        await createNatalProfile(birthData);
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
        <HomeHeader loading={loading} source={source} onRefresh={onRefresh} forecast={forecast} strings={strings} />

        {loading ? <HomeSkeleton strings={strings} /> : null}
        {error ? (
          <HomeError
            message={error.message}
            missingLocation={status === "missing_location"}
            onRetry={onRefresh}
            strings={strings}
          />
        ) : null}

        {forecast ? (
          <>
            <ChakraFlower forecast={forecast} strings={strings} />
            <OpportunityWindows
              planetOfTheDay={forecast.planetOfTheDay}
              windows={forecast.windowsOfOpportunity}
              strings={strings}
            />
            <DailyRecommendationCard
              forecast={forecast}
              strings={strings}
              onDiscuss={() => setCommunicatorOpen(true)}
            />
            <EventBells windows={forecast.windowsOfOpportunity} strings={strings} />
          </>
        ) : null}

        <NatalBridgeCard onOpen={() => setNatalBridgeOpen(true)} />
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
    gap: 16,
    maxWidth: 620,
    paddingHorizontal: 18,
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
  refresh: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
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
  devPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  natalBridgeCard: {
    borderWidth: 1,
    borderRadius: 24,
    gap: 14,
    padding: 16,
  },
  natalBridgeText: {
    gap: 6,
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
