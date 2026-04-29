import { useAuth } from "@/modules/auth";
import { Communicator } from "@/modules/communicator/ui/Communicator";
import type { DailyForecast } from "@/modules/daily-engine";
import { useDailyForecast } from "@/modules/daily-engine/ui/useDailyForecast";
import { ChakraFlower } from "@/modules/home/ui/ChakraFlower";
import { DailyRecommendationCard } from "@/modules/home/ui/DailyRecommendationCard";
import { EventBells } from "@/modules/home/ui/EventBells";
import { OpportunityWindows } from "@/modules/home/ui/OpportunityWindows";
import { PLANET_CHAKRA, PLANET_LABELS, toneLabel } from "@/modules/home/planetChakra";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { StatusBar } from "expo-status-bar";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const DEFAULT_SYSTEM_PROMPT =
  "Ты эмпатичный наставник приложения Harmonizer. Отвечай кратко и по делу.";

function buildDailyDialogInitialMessage(forecast: DailyForecast): string {
  const meta = PLANET_CHAKRA[forecast.planetOfTheDay];
  return [
    "Хочу обсудить рекомендацию дня и подобрать практику.",
    "",
    "Контекст прогноза:",
    `- планета дня: ${PLANET_LABELS[forecast.planetOfTheDay]}`,
    `- чакра: ${meta.chakraName} (${meta.label})`,
    `- тональность: ${toneLabel(forecast.todayPlanetState.todayTone)}`,
  ].join("\n");
}

function HomeHeader({
  loading,
  source,
  onRefresh,
}: {
  loading: boolean;
  source: string | null;
  onRefresh: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        <AppText variant="screenTitle" accessibilityRole="header">
          Harmonizer
        </AppText>
        <AppText variant="screenHint" tone="muted">
          Главная настройка дня: чакры, окна возможностей и мягкая рекомендация.
        </AppText>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Обновить прогноз дня"
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
        <AppText variant="statPillLabel">{loading ? "..." : "Обновить"}</AppText>
      </Pressable>
      {source ? (
        <AppText variant="technicalCaption" tone="faint">
          Источник: {source === "cache" ? "кеш" : "новый расчёт"}
        </AppText>
      ) : null}
    </View>
  );
}

function HomeSkeleton() {
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
        Собираю прогноз дня и окна возможностей...
      </AppText>
    </View>
  );
}

function HomeError({
  message,
  missingLocation,
  onRetry,
}: {
  message: string;
  missingLocation: boolean;
  onRetry: () => void;
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
        {missingLocation ? "Нужна геолокация" : "Не удалось загрузить прогноз"}
      </AppText>
      <AppText variant="screenHint" tone="muted" style={styles.centerText}>
        {message}
      </AppText>
      {!missingLocation ? <AppButton label="Повторить" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

function DevLinks() {
  const theme = useTheme();
  const links = [
    { label: "Biofeedback", href: "/biofeedback-probe" },
    { label: "Mandala", href: "/mandala-sandbox" },
    { label: "Bindu", href: "/bindu-succession-lab" },
    { label: "Symbols", href: "/sacred-symbol-stream" },
    { label: "Breath", href: "/breath-coherence" },
    { label: "Calibration", href: "/calibration" },
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
  onClose,
}: {
  forecast: DailyForecast;
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
          <AppText variant="sectionTitle">Ассистент</AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Закрыть ассистента"
            onPress={onClose}
            style={({ pressed }) => [
              styles.closeButton,
              {
                backgroundColor: theme.colors.controlButtonBg,
                opacity: pressed ? 0.72 : 1,
              },
            ]}
          >
            <AppText variant="buttonLabel">Закрыть</AppText>
          </Pressable>
        </View>
        <Communicator
          key={`${forecast.date}-${forecast.planetOfTheDay}`}
          systemPrompt={DEFAULT_SYSTEM_PROMPT}
          useCase="daily_dialog"
          entrySource="home"
          triggerMeta={{
            forecastDate: forecast.date,
            planetOfTheDay: forecast.planetOfTheDay,
            todayTone: forecast.todayPlanetState.todayTone,
            windowsOfOpportunity: forecast.windowsOfOpportunity,
          }}
          memoryWindow={24}
          autoSendInitialMessage={buildDailyDialogInitialMessage(forecast)}
        />
      </View>
    </Modal>
  );
}

export default function HomeScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { signOut, signingIn } = useAuth();
  const { forecast, loading, error, refresh, source, status } = useDailyForecast();
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
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + 20,
            paddingBottom: insets.bottom + 32,
          },
        ]}
      >
        <HomeHeader loading={loading} source={source} onRefresh={onRefresh} />

        {loading ? <HomeSkeleton /> : null}
        {error ? (
          <HomeError
            message={error.message}
            missingLocation={status === "missing_location"}
            onRetry={onRefresh}
          />
        ) : null}

        {forecast ? (
          <>
            <ChakraFlower
              importance={forecast.importance}
              planetOfTheDay={forecast.planetOfTheDay}
              todayTone={forecast.todayPlanetState.todayTone}
            />
            <OpportunityWindows
              planetOfTheDay={forecast.planetOfTheDay}
              windows={forecast.windowsOfOpportunity}
            />
            <DailyRecommendationCard
              forecast={forecast}
              onDiscuss={() => setCommunicatorOpen(true)}
            />
            <EventBells windows={forecast.windowsOfOpportunity} />
          </>
        ) : null}

        <DevLinks />
        <AppButton
          label={signingIn ? "Выходим..." : "Выйти"}
          variant="secondary"
          onPress={onSignOut}
          disabled={signingIn}
        />
      </ScrollView>

      {communicatorOpen && forecast ? (
        <CommunicatorOverlay forecast={forecast} onClose={() => setCommunicatorOpen(false)} />
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
