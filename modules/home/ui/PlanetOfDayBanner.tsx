import { useMemo } from "react";
import { StyleSheet, View } from "react-native";

import type { DailyForecast } from "@/modules/daily-engine";
import type { HomeStrings } from "@/modules/home/i18n/home";
import { getPlanetChakraMap } from "@/modules/home/planetChakra";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

interface PlanetOfDayBannerProps {
  forecast: DailyForecast;
  strings: HomeStrings;
}

export function PlanetOfDayBanner({ forecast, strings }: PlanetOfDayBannerProps) {
  const theme = useTheme();
  const planet = forecast.planetOfTheDay;
  const meta = useMemo(
    () => getPlanetChakraMap(strings.locale)[planet],
    [planet, strings.locale],
  );
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
      <View style={styles.symbol} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.symbolHalo, { backgroundColor: meta.color }]} />
        <View style={[styles.symbolCore, { backgroundColor: meta.color }]} />
        <View style={[styles.symbolDot, { backgroundColor: theme.colors.screenBg }]} />
      </View>

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
  symbol: {
    alignItems: "center",
    height: 72,
    justifyContent: "center",
    position: "relative",
    width: 72,
  },
  symbolHalo: {
    borderRadius: 32,
    height: 64,
    opacity: 0.18,
    position: "absolute",
    width: 64,
  },
  symbolCore: {
    borderRadius: 22,
    height: 44,
    opacity: 0.82,
    position: "absolute",
    width: 44,
  },
  symbolDot: {
    borderRadius: 8,
    height: 16,
    opacity: 0.72,
    position: "absolute",
    width: 16,
  },
  copy: {
    flex: 1,
    gap: 4,
  },
});
