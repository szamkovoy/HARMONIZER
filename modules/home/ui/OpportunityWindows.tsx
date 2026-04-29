import { StyleSheet, View } from "react-native";

import type { AspectType, DailyForecast, Planet } from "@/modules/daily-engine";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { PLANET_LABELS } from "../planetChakra";

type Windows = DailyForecast["windowsOfOpportunity"];

interface OpportunityWindowsProps {
  planetOfTheDay: Planet;
  windows: Windows;
}

const ASPECT_LABELS: Record<AspectType, string> = {
  conjunction: "соединение",
  opposition: "оппозиция",
  square: "квадрат",
  trine: "трин",
  sextile: "секстиль",
};

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(11, 16);
  return new Intl.DateTimeFormat("ru", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function OpportunityWindows({ planetOfTheDay, windows }: OpportunityWindowsProps) {
  const theme = useTheme();
  const items = [
    {
      key: "sunrise",
      title: "Восход",
      time: windows.sunrise?.time,
      detail: windows.sunrise ? `${PLANET_LABELS[windows.sunrise.planet]} поднимается над горизонтом` : null,
    },
    {
      key: "culmination",
      title: "Кульминация",
      time: windows.culmination?.time,
      detail: windows.culmination ? `${PLANET_LABELS[windows.culmination.planet]} в максимальной силе` : null,
    },
    {
      key: "exactAspect",
      title: "Точный аспект",
      time: windows.exactAspect?.time,
      detail: windows.exactAspect
        ? `${ASPECT_LABELS[windows.exactAspect.aspectType]} к ${PLANET_LABELS[windows.exactAspect.toNatalPlanet]}`
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
        <AppText variant="sectionTitle">Окна возможностей</AppText>
        <AppText variant="technicalCaption" tone="muted">
          Главная тема: {PLANET_LABELS[planetOfTheDay]}
        </AppText>
      </View>

      <View style={styles.timeline}>
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
              <AppText variant="statPillLabel" tone={active ? "primary" : "muted"}>
                {item.title}
              </AppText>
              <AppText variant="screenTitle" style={styles.time}>
                {item.time ? formatTime(item.time) : "—"}
              </AppText>
              <AppText variant="technicalCaption" tone="muted" style={styles.detail}>
                {item.detail ?? "Сегодня без точного окна"}
              </AppText>
            </View>
          );
        })}
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
  timeline: {
    flexDirection: "row",
    gap: 10,
  },
  window: {
    borderWidth: 1,
    borderRadius: 18,
    flex: 1,
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
