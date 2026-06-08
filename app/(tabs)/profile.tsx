import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { DevTierSwitch, requiredTierFor, TIER_LABELS, UpgradeDialog, useAccess, type FeatureKey } from "@/modules/access";
import { useAuth } from "@/modules/auth";
import type { BirthData } from "@/modules/astro-core";
import { NatalBirthDataModal } from "@/modules/home/ui/NatalBirthDataModal";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { HARMONIZER_TEST_MODE } from "@/modules/ui/testMode";
import { useTheme } from "@/modules/ui/theme";
import { DEFAULT_PERIOD_DAYS } from "@/modules/profile/core/periodPresets";
import { getProfileReportStrings } from "@/modules/profile/i18n/profile";
import { ProfileEmptyState } from "@/modules/profile/ui/ProfileEmptyState";
import { ProfileReportCard } from "@/modules/profile/ui/ProfileReportCard";
import {
  LifeMatrixReportCard,
  LifeSpheresReportCard,
  LifeStatesReportCard,
  PracticeByChakraReportCard,
  RangeTrendReportCard,
  useLifeMatrixReport,
} from "@/modules/profile/ui/ProfileReports";
import { PeriodSelector } from "@/modules/profile/ui/PeriodSelector";
import { loadDailyPracticeStats, type DailyPracticeStat } from "@/services/practiceSessions";
import { clearRuntimeDiagnostics, logRuntimeTap, shareRuntimeDiagnosticsReport } from "@/services/runtimeDiagnostics";
import { markHomeDayContentBlockingReload } from "@/services/homeDayContentReloadRequest";
import { createNatalProfile } from "@/services/natalProfileClient";

function errorMessage(value: unknown, fallback = "Неизвестная ошибка"): string {
  if (value instanceof Error && value.message.trim()) return value.message;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    const error = value as { message?: unknown; error?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const message = [error.message, error.error, error.details, error.hint, error.code]
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
      .join(" ");
    if (message) return message;
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export default function ProfileTabRoute() {
  const theme = useTheme();
  const { authUser, profile, refreshProfile } = useAuth();
  const { access, canUseFeature, setDevTierOverride } = useAccess();
  const reportStrings = getProfileReportStrings("ru");
  const [statsPeriodDays, setStatsPeriodDays] = useState<number>(DEFAULT_PERIOD_DAYS);
  const [stats, setStats] = useState<DailyPracticeStat[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const statsEnabled = canUseFeature("stats");
  const lifeMatrix = useLifeMatrixReport(statsEnabled);
  const [natalModalOpen, setNatalModalOpen] = useState(false);
  const [natalSaving, setNatalSaving] = useState(false);
  const [upgradeFeature, setUpgradeFeature] = useState<FeatureKey | null>(null);

  const openBirthEditor = useCallback(() => {
    logRuntimeTap("profile_open_birth_editor");
    if (canUseFeature("calibration")) {
      setNatalModalOpen(true);
    } else {
      setUpgradeFeature("calibration");
    }
  }, [canUseFeature]);

  const loadStats = useCallback(async () => {
    logRuntimeTap("profile_load_stats", { canUseStats: statsEnabled, periodDays: statsPeriodDays });
    if (!authUser?.id || !statsEnabled) {
      setStats([]);
      return;
    }
    setStatsLoading(true);
    setStats(await loadDailyPracticeStats(authUser.id, statsPeriodDays));
    setStatsLoading(false);
  }, [authUser?.id, statsEnabled, statsPeriodDays]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const exportDiagnostics = useCallback(() => {
    logRuntimeTap("profile_export_diagnostics");
    void shareRuntimeDiagnosticsReport().catch((error: unknown) => {
      Alert.alert("Диагностика", error instanceof Error ? error.message : "Не удалось экспортировать JSON.");
    });
  }, []);

  const resetDiagnostics = useCallback(() => {
    clearRuntimeDiagnostics();
    Alert.alert("Диагностика", "Лог очищен. Теперь можно начать чистый 5-10 минутный тест.");
  }, []);

  const onSaveNatal = useCallback(
    async (birthData: BirthData) => {
      setNatalSaving(true);
      try {
        await createNatalProfile(birthData);
        await refreshProfile();
        markHomeDayContentBlockingReload({ forceRefresh: true });
        setNatalModalOpen(false);
        Alert.alert(
          "Готово",
          "Натальный профиль обновлён. На главном экране подтянутся новый прогноз и рекомендации на день. При желании можно пройти калибровку голосом.",
          [
            { text: "Остаться", style: "cancel" },
            {
              text: "К калибровке",
              onPress: () => {
                router.push("/calibration");
              },
            },
            {
              text: "На главную",
              onPress: () => {
                router.replace("/");
              },
            },
          ],
        );
      } catch (error) {
        const message = errorMessage(error, "Не удалось сохранить натальные данные.");
        Alert.alert("Ошибка сохранения", message);
      } finally {
        setNatalSaving(false);
      }
    },
    [refreshProfile],
  );

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
          <AppButton label="Обновить профиль" variant="secondary" onPress={openBirthEditor} />
          <AppText variant="technicalCaption" tone="muted">
            Дата и время рождения (натальная карта). На главной экран обновится после сохранения.
          </AppText>
        </View>

        {__DEV__ ? <DevTierSwitch value={access.devOverride} onChange={setDevTierOverride} /> : null}

        {__DEV__ || HARMONIZER_TEST_MODE ? (
          <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
            <AppText variant="sectionTitle">Диагностика ресурсов</AppText>
            <AppText variant="dialogBody" tone="muted">
              Для теста очистите лог, 5-10 минут походите по приложению, затем экспортируйте JSON и передайте файл.
            </AppText>
            <View style={styles.diagnosticsActions}>
              <AppButton label="Очистить лог" variant="secondary" onPress={resetDiagnostics} style={styles.smallButton} />
              <AppButton label="Экспорт JSON" onPress={exportDiagnostics} style={styles.smallButton} />
            </View>
          </View>
        ) : null}

        <ProfileReportCard
          title={reportStrings.practiceStatsTitle}
          periodSelector={statsEnabled ? <PeriodSelector value={statsPeriodDays} onChange={setStatsPeriodDays} /> : undefined}
        >
          {statsEnabled ? (
            statsLoading ? (
              <AppText variant="dialogBody" tone="muted">
                {reportStrings.statsLoading}
              </AppText>
            ) : chartItems.length ? (
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
              <ProfileEmptyState message={reportStrings.practicesNotDone} />
            )
          ) : (
            <AppText variant="dialogBody" tone="muted">
              {reportStrings.statsUpgradeHint}
            </AppText>
          )}
        </ProfileReportCard>

        <PracticeByChakraReportCard enabled={statsEnabled} onUpgrade={() => setUpgradeFeature("stats")} />
        <LifeMatrixReportCard
          enabled={statsEnabled}
          onUpgrade={() => setUpgradeFeature("stats")}
          report={lifeMatrix.report}
          loading={lifeMatrix.loading}
          error={lifeMatrix.error}
        />
        <LifeSpheresReportCard
          enabled={statsEnabled}
          onUpgrade={() => setUpgradeFeature("stats")}
          report={lifeMatrix.report}
          loading={lifeMatrix.loading}
          error={lifeMatrix.error}
        />
        <LifeStatesReportCard
          enabled={statsEnabled}
          onUpgrade={() => setUpgradeFeature("stats")}
          report={lifeMatrix.report}
          loading={lifeMatrix.loading}
          error={lifeMatrix.error}
        />
        <RangeTrendReportCard
          enabled={statsEnabled}
          onUpgrade={() => setUpgradeFeature("stats")}
          report={lifeMatrix.report}
          loading={lifeMatrix.loading}
          error={lifeMatrix.error}
        />

        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
          <AppText variant="sectionTitle">Скоро здесь</AppText>
          <AppText variant="dialogBody" tone="muted">
            Расширенные настройки профиля и внешний вид — на следующих витках.
          </AppText>
        </View>
      </ScrollView>

      <NatalBirthDataModal
        visible={natalModalOpen}
        saving={natalSaving}
        initialDate={profile?.birth_date}
        initialTime={profile?.birth_time}
        onClose={() => setNatalModalOpen(false)}
        onSubmit={onSaveNatal}
      />
      {upgradeFeature ? (
        <UpgradeDialog
          visible
          feature={upgradeFeature}
          requiredTier={requiredTierFor(upgradeFeature)}
          onClose={() => setUpgradeFeature(null)}
        />
      ) : null}
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
  diagnosticsActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
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
