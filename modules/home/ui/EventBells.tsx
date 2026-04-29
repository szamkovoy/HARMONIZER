import FontAwesome from "@expo/vector-icons/FontAwesome";
import { StyleSheet, View } from "react-native";

import type { DailyForecast } from "@/modules/daily-engine";
import type { HomeStrings } from "@/modules/home/i18n/home";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

type Windows = DailyForecast["windowsOfOpportunity"];

interface EventBellsProps {
  windows: Windows;
  strings: HomeStrings;
}

function isFuture(time: string): boolean {
  const value = new Date(time).getTime();
  return Number.isFinite(value) && value > Date.now();
}

export function EventBells({ windows, strings }: EventBellsProps) {
  const theme = useTheme();
  const events = [
    windows.sunrise
      ? { key: "sunrise", title: strings.opportunityWindows.windowTitles.sunrise, time: windows.sunrise.time }
      : null,
    windows.culmination
      ? {
          key: "culmination",
          title: strings.opportunityWindows.windowTitles.culmination,
          time: windows.culmination.time,
        }
      : null,
    windows.exactAspect
      ? { key: "exactAspect", title: strings.eventBells.aspectTitle, time: windows.exactAspect.time }
      : null,
  ].filter((event): event is { key: string; title: string; time: string } => Boolean(event));

  const upcoming = events.filter((event) => isFuture(event.time));

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
        <FontAwesome name="bell" size={16} color={theme.colors.accent} />
        <AppText variant="sectionTitle">{strings.eventBells.title}</AppText>
      </View>
      {upcoming.length ? (
        <View style={styles.bells}>
          {upcoming.map((event) => (
            <View key={event.key} style={[styles.bell, { borderColor: theme.colors.surfaceBorder }]}>
              <FontAwesome name="bell-o" size={14} color={theme.colors.textMuted} />
              <AppText variant="statPillLabel">{event.title}</AppText>
              <AppText variant="technicalCaption" tone="muted">
                {strings.formatTime(event.time)}
              </AppText>
            </View>
          ))}
        </View>
      ) : (
        <AppText variant="screenHint" tone="muted">
          {strings.eventBells.empty}
        </AppText>
      )}
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
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  bells: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  bell: {
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 999,
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
