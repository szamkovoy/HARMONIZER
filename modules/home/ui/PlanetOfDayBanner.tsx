import { StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import type { DailyForecast } from "@/modules/daily-engine";
import type { HomeStrings } from "@/modules/home/i18n/home";
import { PLANET_CHAKRA } from "@/modules/home/planetChakra";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

interface PlanetOfDayBannerProps {
  forecast: DailyForecast;
  strings: HomeStrings;
}

export function PlanetOfDayBanner({ forecast, strings }: PlanetOfDayBannerProps) {
  const theme = useTheme();
  const planet = forecast.planetOfTheDay;
  const meta = PLANET_CHAKRA[planet];
  const planetLabel = strings.planetLabels[planet];
  const toneLabel = strings.toneLabels[forecast.todayPlanetState.todayTone];

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surfaceElevated,
          borderColor: meta.color,
        },
      ]}
    >
      <Svg width={72} height={72} viewBox="0 0 72 72">
        <Circle cx={36} cy={36} r={32} fill={meta.color} opacity={0.18} />
        <Circle cx={36} cy={36} r={22} fill={meta.color} opacity={0.82} />
        <Circle cx={36} cy={36} r={8} fill={theme.colors.screenBg} opacity={0.72} />
      </Svg>

      <View style={styles.copy}>
        <AppText variant="technicalCaption" tone="muted">
          {strings.planetBanner.eyebrow}
        </AppText>
        <AppText variant="screenTitle">{strings.planetBanner.title(planetLabel)}</AppText>
        <AppText variant="screenHint" tone="muted">
          {strings.planetBanner.chakraLine(meta.chakraNumber, meta.chakraName)}
        </AppText>
        <AppText variant="statPillLabel" style={{ color: meta.color }}>
          {strings.planetBanner.toneLine(toneLabel, meta.label)}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 24,
    flexDirection: "row",
    gap: 16,
    padding: 18,
  },
  copy: {
    flex: 1,
    gap: 4,
  },
});
