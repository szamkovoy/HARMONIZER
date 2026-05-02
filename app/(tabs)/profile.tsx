import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { DevTierSwitch, TIER_LABELS, useAccess } from "@/modules/access";
import { useAuth } from "@/modules/auth";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { loadDailyPracticeStats, type DailyPracticeStat } from "@/services/practiceSessions";

export default function ProfileTabRoute() {
  const theme = useTheme();
  const { authUser, profile, refreshProfile } = useAuth();
  const { access, canUseFeature, setDevTierOverride } = useAccess();
  const [stats, setStats] = useState<DailyPracticeStat[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const refresh = useCallback(() => {
    void refreshProfile();
  }, [refreshProfile]);

  const loadStats = useCallback(async () => {
    if (!authUser?.id || !canUseFeature("stats")) {
      setStats([]);
      return;
    }
    setStatsLoading(true);
    setStats(await loadDailyPracticeStats(authUser.id, 14));
    setStatsLoading(false);
  }, [authUser?.id, canUseFeature]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const chartItems = useMemo(() => [...stats].reverse(), [stats]);
  const maxSeconds = Math.max(60, ...chartItems.map((item) => item.total_practice_seconds ?? 0));

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.colors.screenBg }]}>
      <StatusBar style={theme.scheme === "dark" ? "light" : "dark"} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <AppText variant="screenTitle" accessibilityRole="header">
            Профиль
          </AppText>
          <AppText variant="screenHint" tone="muted">
            Минимальная зона настроек и проверки доступа для первого витка.
          </AppText>
        </View>

        <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
          <AppText variant="sectionTitle">Текущий доступ</AppText>
          <AppText variant="screenHint">{access.label}</AppText>
          <AppText variant="technicalCaption" tone="muted">
            effective tier: {TIER_LABELS[access.tier]} · source: {access.source}
          </AppText>
          <AppText variant="technicalCaption" tone="muted">
            profile tier: {profile?.membership_tier ?? "unknown"} · trial: {profile?.trial_expires_at ?? "нет"}
          </AppText>
          <AppButton label="Обновить профиль" variant="secondary" onPress={refresh} />
        </View>

        {__DEV__ ? <DevTierSwitch value={access.devOverride} onChange={setDevTierOverride} /> : null}

        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
          <View style={styles.cardHeaderRow}>
            <AppText variant="sectionTitle">Статистика практик</AppText>
            <AppButton label="Обновить" variant="secondary" onPress={loadStats} disabled={statsLoading} style={styles.smallButton} />
          </View>
          {canUseFeature("stats") ? (
            chartItems.length ? (
              <View style={styles.chart}>
                {chartItems.map((item) => {
                  const seconds = item.total_practice_seconds ?? 0;
                  const minutes = Math.round(seconds / 60);
                  const height = Math.max(4, Math.round((seconds / maxSeconds) * 96));
                  return (
                    <View key={item.local_date} style={styles.chartColumn}>
                      <View style={styles.barTrack}>
                        <View
                          style={[
                            styles.bar,
                            {
                              height,
                              backgroundColor: theme.colors.accent,
                            },
                          ]}
                        />
                      </View>
                      <AppText variant="technicalCaption" tone="muted">
                        {minutes}
                      </AppText>
                      <AppText variant="technicalCaption" tone="faint">
                        {item.local_date.slice(5)}
                      </AppText>
                    </View>
                  );
                })}
              </View>
            ) : (
              <AppText variant="dialogBody" tone="muted">
                {statsLoading ? "Загружаем статистику..." : "Пока нет сохраненных завершенных практик."}
              </AppText>
            )
          ) : (
            <AppText variant="dialogBody" tone="muted">
              Статистика доступна на тарифах Практик и Мастер.
            </AppText>
          )}
        </View>

        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
          <AppText variant="sectionTitle">Скоро здесь</AppText>
          <AppText variant="dialogBody" tone="muted">
            Палитра и настройки натальных данных появятся на следующих витках.
          </AppText>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    alignSelf: "center",
    gap: 18,
    maxWidth: 460,
    padding: 20,
    width: "100%",
  },
  header: {
    gap: 8,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    gap: 12,
    padding: 16,
  },
  cardHeaderRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  smallButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chart: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 8,
    minHeight: 136,
  },
  chartColumn: {
    alignItems: "center",
    flex: 1,
    gap: 4,
    justifyContent: "flex-end",
  },
  barTrack: {
    height: 100,
    justifyContent: "flex-end",
  },
  bar: {
    borderRadius: 999,
    minWidth: 10,
    width: 12,
  },
});
