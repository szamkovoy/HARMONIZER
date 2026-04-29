import { ScrollView, StyleSheet, View } from "react-native";
import Svg, { Circle, Line } from "react-native-svg";

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

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.timeline}
      >
        {items.map((item) => {
          const active = Boolean(item.time);
          return (
            <View
              key={item.key}
              style={[
                styles.window,
                {
                  borderColor: active ? theme.colors.accent : theme.colors.surfaceBorder,
                  opacity: active ? 1 : 0.58,
                },
              ]}
            >
              <Svg width={76} height={18} viewBox="0 0 76 18">
                <Line
                  x1={0}
                  y1={9}
                  x2={76}
                  y2={9}
                  stroke={active ? theme.colors.accent : theme.colors.surfaceBorder}
                  strokeWidth={1}
                />
                <Circle
                  cx={38}
                  cy={9}
                  r={active ? 6 : 4}
                  fill={active ? theme.colors.accent : theme.colors.controlButtonBg}
                  stroke={theme.colors.surfaceBorder}
                  strokeWidth={1}
                />
              </Svg>
              <AppText variant="statPillLabel" tone={active ? "primary" : "muted"}>
                {item.title}
              </AppText>
              <AppText variant="screenTitle" style={styles.time}>
                {item.time ? strings.formatTime(item.time) : strings.emptyTimeLabel}
              </AppText>
              <AppText variant="technicalCaption" tone="muted" style={styles.detail}>
                {item.detail ?? t.emptyDetail}
              </AppText>
            </View>
          );
        })}
      </ScrollView>
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
  timeline: {
    flexDirection: "row",
    gap: 10,
    paddingRight: 2,
  },
  window: {
    borderWidth: 1,
    borderRadius: 18,
    width: 172,
    minHeight: 118,
    padding: 12,
    justifyContent: "space-between",
  },
  time: {
    marginTop: 8,
  },
  detail: {
    marginTop: 8,
  },
});
