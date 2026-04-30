import { StyleSheet, View } from "react-native";
import Svg, { Circle, Path, Text as SvgText } from "react-native-svg";

import type { AspectType, DailyForecast, Planet } from "@/modules/daily-engine";
import type { HomeStrings } from "@/modules/home/i18n/home";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

type Windows = DailyForecast["windowsOfOpportunity"];

interface OpportunityWindowsProps {
  planetOfTheDay: Planet;
  windows: Windows;
  strings: HomeStrings;
}

export function OpportunityWindows({ planetOfTheDay, windows, strings }: OpportunityWindowsProps) {
  const theme = useTheme();
  const t = strings.opportunityWindows;
  const items = [
    {
      key: "sunrise",
      title: t.windowTitles.sunrise,
      time: windows.sunrise?.time,
      detail: windows.sunrise ? t.sunriseDetail(strings.planetLabels[windows.sunrise.planet]) : null,
    },
    {
      key: "culmination",
      title: t.windowTitles.culmination,
      time: windows.culmination?.time,
      detail: windows.culmination ? t.culminationDetail(strings.planetLabels[windows.culmination.planet]) : null,
    },
    {
      key: "exactAspect",
      title: t.windowTitles.exactAspect,
      time: windows.exactAspect?.time,
      detail: windows.exactAspect
        ? t.exactAspectDetail(
            t.aspectLabels[windows.exactAspect.aspectType as AspectType],
            strings.planetLabels[windows.exactAspect.toNatalPlanet],
          )
        : null,
    },
  ];
  const activeItems = items.filter((item) => item.time);
  const chartPoints = activeItems.length
    ? activeItems.map((item, index) => ({
        ...item,
        x: activeItems.length === 1 ? 150 : 34 + index * (232 / Math.max(1, activeItems.length - 1)),
        y: index % 2 === 0 ? 92 : 36,
      }))
    : [];

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.surfaceBorder,
        },
      ]}
    >
      <View style={styles.header}>
        <AppText variant="sectionTitle">{t.title}</AppText>
        <AppText variant="technicalCaption" tone="muted">
          {t.subtitle(strings.planetLabels[planetOfTheDay])}
        </AppText>
      </View>

      <View style={styles.chartWrap}>
        <Svg width="100%" height={148} viewBox="0 0 300 148">
          <Path
            d="M8 104 C58 18 92 18 142 80 S224 142 292 44"
            fill="none"
            stroke={theme.colors.accent}
            strokeWidth={3}
            strokeLinecap="round"
          />
          {chartPoints.map((point) => (
            <Circle key={point.key} cx={point.x} cy={point.y} r={6} fill={theme.colors.accent} />
          ))}
          {chartPoints.map((point) => (
            <SvgText
              key={`${point.key}-label`}
              x={point.x}
              y={point.y + 26}
              fill={theme.colors.textPrimary}
              fontSize="12"
              fontWeight="600"
              textAnchor="middle"
            >
              {point.time ? strings.formatTime(point.time) : ""}
            </SvgText>
          ))}
        </Svg>
      </View>

      <View style={styles.windowList}>
        {items.map((item) => (
          <View key={item.key} style={styles.windowLine}>
            <AppText variant="statPillLabel">{item.title}</AppText>
            <AppText variant="technicalCaption" tone="muted" style={styles.windowDetail}>
              {item.time ? `${strings.formatTime(item.time)} · ${item.detail}` : t.emptyDetail}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 18,
    gap: 16,
  },
  header: {
    gap: 4,
  },
  chartWrap: {
    height: 148,
    justifyContent: "center",
  },
  windowList: {
    gap: 8,
  },
  windowLine: {
    gap: 2,
  },
  windowDetail: {
    lineHeight: 18,
  },
});
