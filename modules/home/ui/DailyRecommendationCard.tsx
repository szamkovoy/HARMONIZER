import { StyleSheet, View } from "react-native";

import type { DailyForecast } from "@/modules/daily-engine";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { PLANET_CHAKRA, PLANET_LABELS, toneRecommendationVerb } from "../planetChakra";

interface DailyRecommendationCardProps {
  forecast: DailyForecast;
  onDiscuss: () => void;
}

type ForecastWithRecommendation = DailyForecast & {
  recommendationShortText?: string;
};

function fallbackRecommendation(forecast: DailyForecast): string {
  const meta = PLANET_CHAKRA[forecast.planetOfTheDay];
  const verb = toneRecommendationVerb(forecast.todayPlanetState.todayTone);
  return `Сегодня полезно ${verb} ${meta.chakraName.toLowerCase()}: уделите внимание теме «${meta.label}» и выберите практику без спешки.`;
}

export function DailyRecommendationCard({ forecast, onDiscuss }: DailyRecommendationCardProps) {
  const theme = useTheme();
  const withText = forecast as ForecastWithRecommendation;
  const text = withText.recommendationShortText?.trim() || fallbackRecommendation(forecast);
  const meta = PLANET_CHAKRA[forecast.planetOfTheDay];

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surfaceElevated,
          borderColor: theme.colors.surfaceBorder,
        },
      ]}
    >
      <View style={styles.header}>
        <AppText variant="sectionTitle">Рекомендация дня</AppText>
        <AppText variant="technicalCaption" tone="muted">
          {PLANET_LABELS[forecast.planetOfTheDay]} · {meta.chakraName}
        </AppText>
      </View>
      <AppText variant="screenHint">{text}</AppText>
      {forecast.isAlternativeChoice && forecast.alternativeReasonText ? (
        <AppText variant="technicalCaption" tone="muted">
          {forecast.alternativeReasonText}
        </AppText>
      ) : null}
      <AppButton label="Обсудить с ассистентом" onPress={onDiscuss} />
    </View>
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
  },
});
