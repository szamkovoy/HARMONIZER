import FontAwesome from "@expo/vector-icons/FontAwesome";
import { useMemo, useRef, useState } from "react";
import { Alert, Modal, NativeModules, Pressable, StyleSheet, View } from "react-native";

import type { AspectType, DailyForecast, Planet } from "@/modules/daily-engine";
import type { HomeStrings } from "@/modules/home/i18n/home";
import { PLANET_CHAKRA } from "@/modules/home/planetChakra";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

type Windows = DailyForecast["windowsOfOpportunity"];

interface OpportunityWindowsProps {
  planetOfTheDay: Planet;
  windows: Windows;
  strings: HomeStrings;
}

type WindowItem = {
  key: "sunrise" | "culmination" | "exactAspect";
  title: string;
  time?: string;
  detail: string | null;
};

type NotificationsModule = {
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  cancelScheduledNotificationAsync: (identifier: string) => Promise<void>;
  scheduleNotificationAsync: (request: {
    content: { title: string; body: string; data?: Record<string, unknown> };
    trigger: { type: string; date: Date };
  }) => Promise<string>;
  SchedulableTriggerInputTypes?: { DATE?: string };
};

function getOptionalNotifications(): NotificationsModule | null {
  if (!NativeModules.ExpoPushTokenManager) return null;
  try {
    return require("expo-notifications") as NotificationsModule;
  } catch {
    return null;
  }
}

function timeToDayX(time?: string): { x: number; past: boolean } | null {
  if (!time) return null;
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return null;
  const minutes = date.getHours() * 60 + date.getMinutes();
  const x = Math.max(0.02, Math.min(0.98, minutes / 1440));
  return { x, past: date.getTime() < Date.now() };
}

function circularDelta(from: number, to: number): number {
  return to >= from ? to - from : to + 1 - from;
}

function makeSkyY(riseX: number | null, culminationX: number | null) {
  const axisY = 78;
  const amplitude = 42;
  const period = riseX != null && culminationX != null
    ? Math.max(0.45, Math.min(1.35, circularDelta(riseX, culminationX) * 4))
    : 1;
  const phaseRise = riseX ?? ((culminationX ?? 0.35) - period / 4 + 1) % 1;

  return (x: number) => {
    const elapsed = x - phaseRise;
    return axisY - Math.sin((elapsed / period) * Math.PI * 2) * amplitude;
  };
}

function withReadableLabelSlots<T extends { x: number }>(points: T[]): Array<T & { labelX: number }> {
  const sorted = points.map((point, index) => ({ ...point, originalIndex: index })).sort((a, b) => a.x - b.x);
  const minGap = 0.18;
  let previous = -Infinity;
  const placed = sorted.map((point) => {
    const labelX = Math.max(point.x, previous + minGap);
    previous = labelX;
    return { ...point, labelX };
  });
  const overflow = Math.max(0, (placed.at(-1)?.labelX ?? 0) - 0.96);
  return placed
    .map((point) => ({ ...point, labelX: Math.max(0.04, point.labelX - overflow) }))
    .sort((a, b) => a.originalIndex - b.originalIndex)
    .map(({ originalIndex, ...point }) => point as T & { labelX: number });
}

export function OpportunityWindows({ planetOfTheDay, windows, strings }: OpportunityWindowsProps) {
  const theme = useTheme();
  const [reminderTarget, setReminderTarget] = useState<WindowItem | null>(null);
  const [reminderMode, setReminderMode] = useState<"exact" | "before5">("exact");
  const [enabledReminders, setEnabledReminders] = useState<Record<string, "exact" | "before5">>({});
  const notificationIdsRef = useRef<Record<string, string>>({});
  const t = strings.opportunityWindows;
  const lineColor = PLANET_CHAKRA[planetOfTheDay].color;
  const items: WindowItem[] = [
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
  const risePoint = timeToDayX(windows.sunrise?.time);
  const culminationPoint = timeToDayX(windows.culmination?.time);
  const skyY = useMemo(
    () => makeSkyY(risePoint?.x ?? null, culminationPoint?.x ?? null),
    [risePoint?.x, culminationPoint?.x],
  );
  const chartDots = Array.from({ length: 180 }, (_, index) => {
    const x = index / 179;
    return { x, y: skyY(x) };
  });
  const chartPoints = withReadableLabelSlots(
    activeItems
      .map((item) => {
        const point = timeToDayX(item.time);
        return point ? { ...item, ...point, y: skyY(point.x) } : null;
      })
      .filter((item): item is WindowItem & { x: number; y: number; past: boolean } => Boolean(item)),
  );

  async function toggleReminder(item: WindowItem) {
    if (!item.time) return;
    if (enabledReminders[item.key]) {
      const notificationId = notificationIdsRef.current[item.key];
      const notifications = getOptionalNotifications();
      if (notificationId && notifications) {
        await notifications.cancelScheduledNotificationAsync(notificationId).catch(() => undefined);
      }
      delete notificationIdsRef.current[item.key];
      setEnabledReminders((prev) => {
        const next = { ...prev };
        delete next[item.key];
        return next;
      });
      return;
    }
    setReminderMode("exact");
    setReminderTarget(item);
  }

  async function saveReminder() {
    if (!reminderTarget?.time) return;
    const eventDate = new Date(reminderTarget.time);
    const triggerDate = new Date(eventDate.getTime() - (reminderMode === "before5" ? 5 * 60_000 : 0));
    if (triggerDate.getTime() <= Date.now()) {
      Alert.alert("Время уже прошло", "Для прошедшего окна уведомление поставить нельзя.");
      setReminderTarget(null);
      return;
    }

    const notifications = getOptionalNotifications();
    if (!notifications) {
      Alert.alert(
        "Уведомления пока недоступны",
        "Текущая сборка приложения запущена без native-модуля уведомлений. После новой dev/release-сборки колокольчики смогут ставить системные уведомления.",
      );
      return;
    }

    const permissions = await notifications.requestPermissionsAsync();
    if (!permissions.granted) {
      Alert.alert("Нужны уведомления", "Разрешите уведомления, чтобы Harmonizer мог напомнить об окне возможностей.");
      return;
    }

    const previousId = notificationIdsRef.current[reminderTarget.key];
    if (previousId) await notifications.cancelScheduledNotificationAsync(previousId).catch(() => undefined);

    const notificationId = await notifications.scheduleNotificationAsync({
      content: {
        title: "Окно возможностей",
        body: `${reminderTarget.title} в ${strings.formatTime(reminderTarget.time)}. ${reminderTarget.detail ?? ""}`.trim(),
        data: { source: "home_opportunity_window", key: reminderTarget.key },
      },
      trigger: { type: notifications.SchedulableTriggerInputTypes?.DATE ?? "date", date: triggerDate },
    });
    notificationIdsRef.current[reminderTarget.key] = notificationId;
    setEnabledReminders((prev) => ({ ...prev, [reminderTarget.key]: reminderMode }));
    setReminderTarget(null);
  }

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
        <View style={[styles.axis, { backgroundColor: theme.colors.surfaceBorder }]} />
        {chartDots.map((dot, index) => (
          <View
            key={index}
            style={[
              styles.waveDot,
              {
                backgroundColor: lineColor,
                left: `${dot.x * 100}%`,
                opacity: 0.18 + index / chartDots.length * 0.24,
                top: dot.y,
              },
            ]}
          />
        ))}
        {chartPoints.map((point) => (
          <Pressable
            key={point.key}
            disabled={point.past}
            onPress={() => void toggleReminder(point)}
            style={[
              styles.marker,
              {
                left: `${point.labelX * 100}%`,
                opacity: point.past ? 0.45 : 1,
              },
            ]}
          >
            <View
              style={[
                styles.dash,
                {
                  borderColor: theme.colors.surfaceBorder,
                  left: `${((point.x - point.labelX) * 100) + 50}%`,
                  top: Math.min(point.y + 8, 78),
                },
              ]}
            />
            <View
              style={[
                styles.point,
                {
                  backgroundColor: lineColor,
                  left: `${((point.x - point.labelX) * 100) + 50}%`,
                  top: point.y,
                },
              ]}
            />
            <View style={styles.markerLabel}>
              <FontAwesome
                name={enabledReminders[point.key] ? "bell" : "bell-o"}
                size={13}
                color={enabledReminders[point.key] ? theme.colors.danger : point.past ? theme.colors.textFaint : theme.colors.textPrimary}
              />
              <AppText variant="technicalCaption" tone={point.past ? "faint" : "primary"} style={styles.markerTime}>
                {point.time ? strings.formatTime(point.time) : ""}
              </AppText>
            </View>
          </Pressable>
        ))}
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
      <Modal animationType="fade" transparent visible={Boolean(reminderTarget)} onRequestClose={() => setReminderTarget(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
            <AppText variant="sectionTitle">Уведомить</AppText>
            {(["exact", "before5"] as const).map((mode) => (
              <Pressable key={mode} style={styles.radioRow} onPress={() => setReminderMode(mode)}>
                <View style={[styles.radio, { borderColor: theme.colors.surfaceBorder }]}>
                  {reminderMode === mode ? <View style={[styles.radioDot, { backgroundColor: theme.colors.accent }]} /> : null}
                </View>
                <AppText variant="screenHint">{mode === "exact" ? "точно" : "за 5 минут"}</AppText>
              </Pressable>
            ))}
            <View style={styles.modalActions}>
              <Pressable onPress={() => setReminderTarget(null)} style={styles.modalButton}>
                <AppText variant="buttonLabel">Отмена</AppText>
              </Pressable>
              <Pressable
                onPress={() => void saveReminder()}
                style={[styles.modalButton, { backgroundColor: theme.colors.buttonPrimaryBg }]}
              >
                <AppText variant="buttonLabel" tone="accentOn">Сохранить</AppText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
    height: 152,
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
  },
  axis: {
    height: StyleSheet.hairlineWidth,
    left: 0,
    position: "absolute",
    right: 0,
    top: 78,
  },
  waveDot: {
    borderRadius: 999,
    height: 4,
    marginLeft: -2,
    position: "absolute",
    width: 4,
  },
  marker: {
    alignItems: "center",
    height: 148,
    marginLeft: -32,
    position: "absolute",
    top: 0,
    width: 64,
  },
  point: {
    borderRadius: 999,
    height: 12,
    marginLeft: -6,
    position: "absolute",
    width: 12,
  },
  dash: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderStyle: "dashed",
    bottom: 68,
    position: "absolute",
  },
  markerLabel: {
    alignItems: "center",
    bottom: 6,
    flexDirection: "row",
    gap: 4,
    justifyContent: "center",
    position: "absolute",
  },
  markerTime: {
    fontWeight: "700",
  },
  modalBackdrop: {
    alignItems: "center",
    backgroundColor: "rgba(15, 23, 42, 0.42)",
    flex: 1,
    justifyContent: "center",
    padding: 20,
  },
  modalCard: {
    borderRadius: 22,
    borderWidth: 1,
    gap: 12,
    maxWidth: 360,
    padding: 18,
    width: "100%",
  },
  radioRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    paddingVertical: 4,
  },
  radio: {
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    height: 22,
    justifyContent: "center",
    width: 22,
  },
  radioDot: {
    borderRadius: 999,
    height: 12,
    width: 12,
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end",
    paddingTop: 4,
  },
  modalButton: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
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
