import { useAuth } from "@/modules/auth";
import { Communicator } from "@/modules/communicator/ui/Communicator";
import type { DailyForecast } from "@/modules/daily-engine";
import { useDailyForecast } from "@/modules/daily-engine/ui/useDailyForecast";
import { getHomeStrings, type HomeStrings } from "@/modules/home/i18n/home";
import { ChakraFlower } from "@/modules/home/ui/ChakraFlower";
import { DailyRecommendationCard } from "@/modules/home/ui/DailyRecommendationCard";
import { EventBells } from "@/modules/home/ui/EventBells";
import { OpportunityWindows } from "@/modules/home/ui/OpportunityWindows";
import { PlanetOfDayBanner } from "@/modules/home/ui/PlanetOfDayBanner";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type ForecastSource = "cache" | "computed";

function HomeHeader({
  loading,
  source,
  onRefresh,
  strings,
}: {
  loading: boolean;
  source: ForecastSource | null;
  onRefresh: () => void;
  strings: HomeStrings;
}) {
  const theme = useTheme();
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <AppText variant="screenTitle" accessibilityRole="header">
          {strings.appTitle}
        </AppText>
        <AppText variant="screenHint" tone="muted">
          {strings.headerHint}
        </AppText>
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
  const { profile, signOut, signingIn } = useAuth();
  const strings = useMemo(
    () => getHomeStrings(profile?.locale === "en" ? "en" : "ru"),
    [profile?.locale],
  );
  const { forecast, loading, error, refresh, source, status } = useDailyForecast({
    locationErrorMessage: strings.locationErrorMessage,
  });
  const [communicatorOpen, setCommunicatorOpen] = useState(false);

  const onSignOut = useCallback(async () => {
    // AuthProvider: await supabase.auth.signOut() + signOutGoogle при необходимости.
    await signOut();
  }, [signOut]);

  const onRefresh = useCallback(() => {
    void refresh({ forceRefresh: true });
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
        <HomeHeader loading={loading} source={source} onRefresh={onRefresh} strings={strings} />

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
            <PlanetOfDayBanner forecast={forecast} strings={strings} />
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
  headerText: {
    gap: 8,
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
