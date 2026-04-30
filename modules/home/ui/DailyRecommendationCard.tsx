import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";

import type { DailyForecast } from "@/modules/daily-engine";
import type { HomeStrings } from "@/modules/home/i18n/home";
import { getForecastRecommendation } from "@/modules/home/i18n/home";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { PLANET_CHAKRA } from "../planetChakra";

interface DailyRecommendationCardProps {
  forecast: DailyForecast;
  strings: HomeStrings;
  onDiscuss: () => void;
}

export function DailyRecommendationCard({ forecast, strings, onDiscuss }: DailyRecommendationCardProps) {
  const theme = useTheme();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const text = getForecastRecommendation(forecast, strings);
  const meta = PLANET_CHAKRA[forecast.planetOfTheDay];
  const tone = strings.toneLabels[forecast.todayPlanetState.todayTone];
  const detailText = [
    `Сегодня алгоритм выделил тему «${meta.label}»: её важность выше остальных направлений дня.`,
    `Тональность сейчас ${tone}, поэтому рекомендация сформулирована как практическое задание: удерживать состояние, которое поддерживает ${meta.chakraName.toLowerCase()}, и не разгонять автоматические реакции.`,
    forecast.isAlternativeChoice && forecast.alternativeReasonText
      ? forecast.alternativeReasonText
      : "Если эта тема повторялась несколько дней подряд, приложение может выбрать вторую по значимости чакру, чтобы усилия не зацикливались.",
    "Окна возможностей ниже показывают моменты, когда телу и вниманию легче перестроиться: восход даёт импульс, кульминация усиливает проявление, точный аспект делает тему особенно заметной.",
  ].join("\n\n");

  return (
    <>
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.surfaceElevated,
            borderColor: theme.colors.surfaceBorder,
          },
        ]}
      >
        <View style={styles.headerRow}>
          <View style={styles.header}>
            <AppText variant="sectionTitle">{strings.recommendation.title}</AppText>
            <AppText variant="technicalCaption" tone="muted">
              {strings.recommendation.meta(strings.planetLabels[forecast.planetOfTheDay], meta.chakraName)}
            </AppText>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Открыть подробное обоснование рекомендации"
            onPress={() => setDetailsOpen(true)}
            style={({ pressed }) => [
              styles.infoButton,
              {
                borderColor: theme.colors.surfaceBorder,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <FontAwesome name="info" size={15} color={theme.colors.textPrimary} />
          </Pressable>
        </View>
        <AppText variant="screenHint">{text}</AppText>
        {forecast.isAlternativeChoice && forecast.alternativeReasonText ? (
          <AppText variant="technicalCaption" tone="muted">
            {forecast.alternativeReasonText}
          </AppText>
        ) : null}
        <AppButton label={strings.recommendation.discussButton} onPress={onDiscuss} />
      </View>
      <Modal animationType="fade" transparent visible={detailsOpen} onRequestClose={() => setDetailsOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: theme.colors.surfaceElevated,
                borderColor: theme.colors.surfaceBorder,
              },
            ]}
          >
            <AppText variant="sectionTitle">Почему именно так</AppText>
            <AppText variant="screenHint" tone="muted">
              {detailText}
            </AppText>
            <AppButton label="Понятно" variant="secondary" onPress={() => setDetailsOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 18,
    gap: 14,
  },
  header: {
    gap: 4,
    flex: 1,
  },
  headerRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  infoButton: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  modalBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(15, 23, 42, 0.42)",
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    borderRadius: 24,
    borderWidth: 1,
    gap: 14,
    maxWidth: 520,
    padding: 18,
    width: "100%",
  },
});
