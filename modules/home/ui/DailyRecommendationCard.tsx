import { StyleSheet, View } from "react-native";

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
  const text = getForecastRecommendation(forecast, strings);
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
        <AppText variant="sectionTitle">{strings.recommendation.title}</AppText>
        <AppText variant="technicalCaption" tone="muted">
          {strings.recommendation.meta(strings.planetLabels[forecast.planetOfTheDay], meta.chakraName)}
        </AppText>
      </View>
      <AppText variant="screenHint">{text}</AppText>
      {forecast.isAlternativeChoice && forecast.alternativeReasonText ? (
        <AppText variant="technicalCaption" tone="muted">
          {forecast.alternativeReasonText}
        </AppText>
      ) : null}
      <AppButton label={strings.recommendation.discussButton} onPress={onDiscuss} />
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
