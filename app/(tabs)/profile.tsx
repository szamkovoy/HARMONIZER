import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { router } from "expo-router";

import {
  AccountGateDialog,
  DevTierSwitch,
  TIER_LABELS,
  useAccess,
  type FeatureKey,
} from "@/modules/access";
import { openAccountCabinet, useAccountLinksEnabled } from "@/modules/account";
import { useAuth } from "@/modules/auth";
import { DonutVisibilityProvider, useDonutScrollProps, useDonutVisibilityRefresh } from "@/modules/charts";
import { APP_LOCALE_OPTIONS, useAppLocale, useTranslate, t as translate, type AppLocale } from "@/modules/i18n";
import type { BirthData } from "@/modules/astro-core";
import { NatalBirthDataModal } from "@/modules/home/ui/NatalBirthDataModal";
import { fetchUnreadNotificationCount } from "@/modules/notifications";
import { SupportModal } from "@/modules/support";
import { AppButton } from "@/modules/ui/AppButton";
import { AppDialog } from "@/modules/ui/AppDialog";
import { AppText } from "@/modules/ui/AppText";
import { BlockingStatusToast } from "@/modules/ui/BlockingStatusToast";
import { ComboBox, ComboBoxDismissOverlay } from "@/modules/ui/ComboBox";
import { ScreenHeader } from "@/modules/ui/ScreenHeader";
import { SURFACE_CARD } from "@/modules/ui/surfaceCard";
import { TabScreenLayout, TabScrollView } from "@/modules/ui/TabScreenLayout";
import { HARMONIZER_TEST_MODE } from "@/modules/ui/testMode";
import { useTheme } from "@/modules/ui/theme";
import { DEFAULT_PERIOD_DAYS } from "@/modules/profile/core/periodPresets";
import {
  buildPracticeStatsChartModel,
  practiceStatsLocalWindow,
} from "@/modules/profile/core/practiceStatsChart";
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
import { PracticeStatsChart } from "@/modules/profile/ui/PracticeStatsChart";
import { loadDailyPracticeStatsInRange, type DailyPracticeStat } from "@/services/practiceSessions";
import { clearRuntimeDiagnostics, logRuntimeTap, shareRuntimeDiagnosticsReport } from "@/services/runtimeDiagnostics";
import { markHomeDayContentBlockingReload } from "@/services/homeDayContentReloadRequest";
import { createNatalProfile } from "@/services/natalProfileClient";
import { resolveDayContentAccessKeys } from "@/services/dayContentAccessKeys";
import { dayContentLocationFallback } from "@/modules/location/defaultDayContentLocation";
import { publishLocaleDayContentWarm } from "@/services/localeDayContentBridge";
import { ensureLocaleDayContent } from "@/services/localeDayContentEnsure";
import { peekLocaleDayContentComplete, probeLocaleDayContentReady } from "@/services/localeDayContentProbe";
import type { AccessMode } from "@/services/globalContentClient";

type LocaleRebuildState =
  | { phase: "idle" }
  | { phase: "confirm"; pendingLocale: AppLocale; previousLocale: AppLocale; accessMode: AccessMode }
  | { phase: "loading"; pendingLocale: AppLocale; previousLocale: AppLocale; accessMode: AccessMode }
  | {
      phase: "error";
      pendingLocale: AppLocale;
      previousLocale: AppLocale;
      accessMode: AccessMode;
      message: string;
    };

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
  const { locale, setLocale, testMode } = useAppLocale();
  const { t } = useTranslate();
  const [localeOpen, setLocaleOpen] = useState(false);
  const [localeRebuild, setLocaleRebuild] = useState<LocaleRebuildState>({ phase: "idle" });
  /** Combo shows the picked language immediately; store locale commits after ensure. */
  const [optimisticLocale, setOptimisticLocale] = useState<AppLocale | null>(null);
  const localeEnsureAbortRef = useRef<AbortController | null>(null);

  /** Same keys as Home `useDayContent` (`accessModeForTier` + `access.tier`). */
  const { accessMode: dayAccessMode, accessTier: dayContentAccessTier } = useMemo(
    () => resolveDayContentAccessKeys(access.tier),
    [access.tier],
  );

  const resolveUserLocation = useCallback(() => {
    if (typeof profile?.lat === "number" && typeof profile?.lon === "number") {
      return {
        lat: profile.lat,
        lng: profile.lon,
        timezone: profile?.tz?.trim() || "UTC",
      };
    }
    // Free ensure still needs a location object for windows; Moscow fallback matches natal bridge.
    return dayContentLocationFallback(profile?.tz);
  }, [profile?.lat, profile?.lon, profile?.tz]);

  const commitLocale = useCallback(
    (code: AppLocale) => {
      void setLocale(code);
      setOptimisticLocale(null);
      setLocaleOpen(false);
      setLocaleRebuild({ phase: "idle" });
    },
    [setLocale],
  );

  const runLocaleEnsure = useCallback(
    async (params: {
      code: AppLocale;
      previousLocale: AppLocale;
      accessMode: AccessMode;
      forceRefresh: boolean;
    }) => {
      if (!authUser?.id) {
        commitLocale(params.code);
        return;
      }
      setLocaleRebuild({
        phase: "loading",
        pendingLocale: params.code,
        previousLocale: params.previousLocale,
        accessMode: params.accessMode,
      });
      localeEnsureAbortRef.current?.abort();
      const controller = new AbortController();
      localeEnsureAbortRef.current = controller;
      try {
        const ensureOnce = async (forceRefresh: boolean) =>
          ensureLocaleDayContent({
            userId: authUser.id,
            locale: params.code,
            accessMode: params.accessMode,
            accessTier: dayContentAccessTier,
            userLocation: resolveUserLocation(),
            birthDate: profile?.birth_date,
            birthTime: profile?.birth_time,
            birthPlace: profile?.birth_place,
            forceRefresh,
            signal: controller.signal,
          });

        // Phone cache already complete for this locale (e.g. switch back DE→EN) — no LLM.
        const peekArgs = {
          userId: authUser.id,
          locale: params.code,
          accessMode: params.accessMode,
          accessTier: dayContentAccessTier,
          timezone: profile?.tz?.trim() || "UTC",
          birthDate: profile?.birth_date,
          birthTime: profile?.birth_time,
          birthPlace: profile?.birth_place,
          lat: profile?.lat,
          lon: profile?.lon,
        };
        let warmed =
          !params.forceRefresh && peekLocaleDayContentComplete(peekArgs)
            ? await ensureOnce(false)
            : null;
        if (!warmed) {
          warmed = await ensureOnce(params.forceRefresh);
          if (controller.signal.aborted) return;
        }
        if (!peekLocaleDayContentComplete(peekArgs)) {
          if (params.accessMode === "free") {
            // Free texts already live in `warmed` / server cache — do not force LLM regen
            // just because SecureStore peek lags after app restart.
            if (!warmed) throw new Error(t("profile.language.rebuildError"));
          } else {
            warmed = await ensureOnce(true);
            if (controller.signal.aborted) return;
            if (!peekLocaleDayContentComplete(peekArgs)) {
              throw new Error(t("profile.language.rebuildError"));
            }
          }
        }

        // Hand off to Home before setAppLocale so Navigator paints texts immediately.
        publishLocaleDayContentWarm(warmed);
        commitLocale(params.code);
      } catch (error) {
        if (controller.signal.aborted) return;
        const raw = errorMessage(error, t("profile.language.rebuildError"));
        const isTechnicalMismatch =
          /language mismatch|LOCALE_MISMATCH|wrong language/i.test(raw) ||
          raw.startsWith("Day content language mismatch");
        setOptimisticLocale(null);
        setLocaleRebuild({
          phase: "error",
          pendingLocale: params.code,
          previousLocale: params.previousLocale,
          accessMode: params.accessMode,
          message: isTechnicalMismatch ? t("profile.language.rebuildError") : raw || t("profile.language.rebuildError"),
        });
      } finally {
        if (localeEnsureAbortRef.current === controller) {
          localeEnsureAbortRef.current = null;
        }
      }
    },
    [
      authUser?.id,
      commitLocale,
      dayContentAccessTier,
      profile?.birth_date,
      profile?.birth_place,
      profile?.birth_time,
      profile?.lat,
      profile?.lon,
      profile?.tz,
      resolveUserLocation,
      t,
    ],
  );

  const handleLocalePick = useCallback(
    async (code: AppLocale) => {
      if (code === (optimisticLocale ?? locale)) {
        setLocaleOpen(false);
        return;
      }
      // Show the chosen language in the combo immediately.
      setOptimisticLocale(code);
      setLocaleOpen(false);
      if (!authUser?.id) {
        commitLocale(code);
        return;
      }
      try {
        const probe = await probeLocaleDayContentReady({
          userId: authUser.id,
          locale: code,
          accessMode: dayAccessMode,
          accessTier: dayContentAccessTier,
          timezone: profile?.tz?.trim() || "UTC",
          birthDate: profile?.birth_date,
          birthTime: profile?.birth_time,
          birthPlace: profile?.birth_place,
          lat: profile?.lat,
          lon: profile?.lon,
        });
        if (probe.ready) {
          // Texts exist — still show translating overlay while we warm phone cache.
          await runLocaleEnsure({
            code,
            previousLocale: locale,
            accessMode: probe.accessMode,
            forceRefresh: false,
          });
          return;
        }
        setLocaleRebuild({
          phase: "confirm",
          pendingLocale: code,
          previousLocale: locale,
          accessMode: probe.accessMode,
        });
      } catch {
        setLocaleRebuild({
          phase: "confirm",
          pendingLocale: code,
          previousLocale: locale,
          accessMode: dayAccessMode,
        });
      }
    },
    [
      authUser?.id,
      commitLocale,
      dayAccessMode,
      dayContentAccessTier,
      locale,
      optimisticLocale,
      profile?.birth_date,
      profile?.birth_place,
      profile?.birth_time,
      profile?.lat,
      profile?.lon,
      profile?.tz,
      runLocaleEnsure,
    ],
  );

  const cancelLocaleRebuild = useCallback(() => {
    localeEnsureAbortRef.current?.abort();
    localeEnsureAbortRef.current = null;
    setOptimisticLocale(null);
    setLocaleRebuild({ phase: "idle" });
    setLocaleOpen(false);
  }, []);

  const continueLocaleRebuild = useCallback(async () => {
    if (localeRebuild.phase !== "confirm" && localeRebuild.phase !== "error") return;
    await runLocaleEnsure({
      code: localeRebuild.pendingLocale,
      previousLocale: localeRebuild.previousLocale,
      accessMode: localeRebuild.accessMode,
      forceRefresh: true,
    });
  }, [localeRebuild, runLocaleEnsure]);

  const reportLocale = locale;
  const reportStrings = getProfileReportStrings(reportLocale);
  const donutScrollProps = useDonutScrollProps();
  const refreshDonutVisibility = useDonutVisibilityRefresh();
  const [statsPeriodDays, setStatsPeriodDays] = useState<number>(DEFAULT_PERIOD_DAYS);
  const [stats, setStats] = useState<DailyPracticeStat[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const statsEnabled = canUseFeature("stats");
  const lifeMatrix = useLifeMatrixReport(statsEnabled, reportLocale);
  const [natalModalOpen, setNatalModalOpen] = useState(false);
  const [natalSaving, setNatalSaving] = useState(false);
  const [upgradeFeature, setUpgradeFeature] = useState<FeatureKey | null>(null);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [supportOpen, setSupportOpen] = useState(false);
  const [cabinetOpening, setCabinetOpening] = useState(false);
  const [cabinetError, setCabinetError] = useState<string | null>(null);
  const linksEnabled = useAccountLinksEnabled();

  const onOpenCabinet = useCallback(async () => {
    logRuntimeTap("profile_open_cabinet", {});
    setCabinetError(null);
    setCabinetOpening(true);
    try {
      await openAccountCabinet();
    } catch (error) {
      setCabinetError(error instanceof Error ? error.message : String(error));
    } finally {
      setCabinetOpening(false);
    }
  }, []);

  const localeOptions = useMemo(
    () =>
      APP_LOCALE_OPTIONS.map((option) => ({
        value: option.code,
        label: option.enabled
          ? option.nativeLabel
          : `${option.nativeLabel} (${t("profile.language.comingSoon")})`,
        disabled: !option.enabled,
      })),
    [t],
  );
  const localeDisplayValue =
    APP_LOCALE_OPTIONS.find((option) => option.code === (optimisticLocale ?? locale))?.nativeLabel ??
    (optimisticLocale ?? locale);

  useFocusEffect(
    useCallback(() => {
      if (!authUser?.id) return;
      let cancelled = false;
      void fetchUnreadNotificationCount(authUser.id).then((count) => {
        if (!cancelled) setUnreadNotifications(count);
      });
      return () => {
        cancelled = true;
      };
    }, [authUser?.id]),
  );

  useFocusEffect(
    useCallback(() => {
      return () => {
        localeEnsureAbortRef.current?.abort();
        localeEnsureAbortRef.current = null;
        setLocaleOpen(false);
        setLocaleRebuild({ phase: "idle" });
      };
    }, []),
  );

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
    const timezone = profile?.tz?.trim() || "UTC";
    const { fromLocalDate, throughLocalDate } = practiceStatsLocalWindow(statsPeriodDays, timezone);
    setStatsLoading(true);
    setStats(await loadDailyPracticeStatsInRange(authUser.id, fromLocalDate, throughLocalDate));
    setStatsLoading(false);
  }, [authUser?.id, profile?.tz, statsEnabled, statsPeriodDays]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useFocusEffect(
    useCallback(() => {
      refreshDonutVisibility();
    }, [refreshDonutVisibility]),
  );

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
    async (birthData: BirthData, placeName: string) => {
      setNatalSaving(true);
      try {
        await createNatalProfile(birthData, undefined, { placeName });
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

  const practiceStatsModel = useMemo(
    () =>
      buildPracticeStatsChartModel({
        rows: stats,
        periodDays: statsPeriodDays,
        timezone: profile?.tz?.trim() || "UTC",
      }),
    [profile?.tz, stats, statsPeriodDays],
  );

  return (
    <DonutVisibilityProvider>
      <TabScreenLayout>
        <TabScrollView contentOptions={{ maxWidth: 460 }} {...donutScrollProps}>
        <ScreenHeader title={t("profile.title")} subtitle={t("profile.subtitle")} />

        <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
          <AppText variant="sectionTitle">{t("profile.access.title")}</AppText>
          <AppText variant="screenHint">{access.label}</AppText>
          <AppText variant="technicalCaption" tone="muted">
            effective tier: {TIER_LABELS[access.tier]} · source: {access.source}
          </AppText>
          <AppText variant="technicalCaption" tone="muted">
            profile tier: {profile?.membership_tier ?? "unknown"} · trial: {profile?.trial_expires_at ?? "нет"}
          </AppText>
          <AppButton label={t("profile.access.updateButton")} variant="secondary" onPress={openBirthEditor} />
          <AppText variant="technicalCaption" tone="muted">
            {t("profile.access.birthHint")}
          </AppText>
          {linksEnabled ? (
            <>
              <AppButton
                label={cabinetOpening ? "…" : t("gate.openCabinet")}
                onPress={() => void onOpenCabinet()}
                disabled={cabinetOpening}
              />
              {cabinetError ? (
                <AppText variant="technicalCaption" style={{ color: theme.colors.danger }}>
                  {t("gate.cabinetError")}
                </AppText>
              ) : null}
            </>
          ) : null}
        </View>

        <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
          <AppText variant="sectionTitle">{t("notifications.title")}</AppText>
          <AppText variant="screenHint" tone="muted">
            {t("notifications.profileHint")}
          </AppText>
          <AppButton
            label={
              unreadNotifications > 0
                ? `${t("notifications.openButton")} (${unreadNotifications})`
                : t("notifications.openButton")
            }
            variant="secondary"
            onPress={() => {
              setUnreadNotifications(0);
              router.push("/my-notifications" as never);
            }}
          />
        </View>

        <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
          <AppText variant="sectionTitle">{t("support.title")}</AppText>
          <AppText variant="screenHint" tone="muted">
            {t("support.profileHint")}
          </AppText>
          <AppButton label={t("support.openButton")} variant="secondary" onPress={() => setSupportOpen(true)} />
        </View>

        <View
          style={[
            styles.card,
            styles.localeCard,
            { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder },
          ]}
        >
          <AppText variant="sectionTitle">{t("profile.language.title")}</AppText>
          <AppText variant="screenHint" tone="muted">
            {t("profile.language.hint")}
          </AppText>
          <ComboBox
            variant="pill"
            id="profile-locale"
            label={t("profile.language.title")}
            value={optimisticLocale ?? locale}
            displayValue={localeDisplayValue}
            options={localeOptions}
            open={localeOpen}
            onOpenChange={setLocaleOpen}
            onChange={(code) => {
              void handleLocalePick(code);
            }}
          />
          {testMode ? (
            <AppText variant="technicalCaption" tone="muted">
              {t("profile.language.testModeNote")}
            </AppText>
          ) : null}
          <ComboBoxDismissOverlay active={localeOpen} onDismiss={() => setLocaleOpen(false)} />
        </View>

        <AppDialog
          visible={localeRebuild.phase === "confirm" || localeRebuild.phase === "error"}
          title={t("profile.language.rebuildTitle")}
          message={
            localeRebuild.phase === "error" ? localeRebuild.message : t("profile.language.rebuildMessage")
          }
          onRequestClose={cancelLocaleRebuild}
          actions={
            <>
              <AppButton
                label={t("profile.language.rebuildCancel")}
                variant="secondary"
                onPress={cancelLocaleRebuild}
              />
              <AppButton
                label={t("profile.language.rebuildContinue")}
                onPress={() => {
                  void continueLocaleRebuild();
                }}
              />
            </>
          }
        />

        <BlockingStatusToast
          visible={localeRebuild.phase === "loading"}
          message={
            localeRebuild.phase === "loading"
              ? translate(localeRebuild.pendingLocale, "profile.language.translating")
              : ""
          }
        />

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
          periodSelector={statsEnabled ? <PeriodSelector value={statsPeriodDays} onChange={setStatsPeriodDays} locale={reportLocale} /> : undefined}
        >
          {statsEnabled ? (
            statsLoading ? (
              <AppText variant="dialogBody" tone="muted">
                {reportStrings.statsLoading}
              </AppText>
            ) : practiceStatsModel.hasAnyPractice ? (
              <PracticeStatsChart
                model={practiceStatsModel}
                unitHint={reportStrings.practiceStatsUnitHint}
                weeklyHint={reportStrings.practiceStatsWeeklyHint}
                scrubTotalLabel={reportStrings.practiceStatsScrubTotalLabel}
                minutesUnit={reportStrings.practiceStatsMinutesUnit}
                locale={reportLocale}
              />
            ) : (
              <ProfileEmptyState message={reportStrings.practicesNotDone} />
            )
          ) : (
            <AppText variant="dialogBody" tone="muted">
              {reportStrings.statsUpgradeHint}
            </AppText>
          )}
        </ProfileReportCard>

        <PracticeByChakraReportCard enabled={statsEnabled} onUpgrade={() => setUpgradeFeature("stats")} locale={reportLocale} />
        <LifeMatrixReportCard
          enabled={statsEnabled}
          onUpgrade={() => setUpgradeFeature("stats")}
          report={lifeMatrix.report}
          loading={lifeMatrix.loading}
          error={lifeMatrix.error}
          locale={reportLocale}
          onRetry={() => void lifeMatrix.reload()}
          retryLabel={lifeMatrix.retryLabel}
        />
        <LifeSpheresReportCard
          enabled={statsEnabled}
          onUpgrade={() => setUpgradeFeature("stats")}
          report={lifeMatrix.report}
          loading={lifeMatrix.loading}
          error={lifeMatrix.error}
          locale={reportLocale}
          onRetry={() => void lifeMatrix.reload()}
          retryLabel={lifeMatrix.retryLabel}
        />
        <LifeStatesReportCard
          enabled={statsEnabled}
          onUpgrade={() => setUpgradeFeature("stats")}
          report={lifeMatrix.report}
          loading={lifeMatrix.loading}
          error={lifeMatrix.error}
          locale={reportLocale}
          onRetry={() => void lifeMatrix.reload()}
          retryLabel={lifeMatrix.retryLabel}
        />
        <RangeTrendReportCard
          enabled={statsEnabled}
          onUpgrade={() => setUpgradeFeature("stats")}
          report={lifeMatrix.report}
          loading={lifeMatrix.loading}
          error={lifeMatrix.error}
          locale={reportLocale}
          onRetry={() => void lifeMatrix.reload()}
          retryLabel={lifeMatrix.retryLabel}
        />

        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.surfaceBorder }]}>
          <AppText variant="sectionTitle">{t("profile.comingSoon.title")}</AppText>
          <AppText variant="dialogBody" tone="muted">
            {t("profile.comingSoon.body")}
          </AppText>
        </View>
      </TabScrollView>

      <SupportModal visible={supportOpen} onClose={() => setSupportOpen(false)} />
      <NatalBirthDataModal
        visible={natalModalOpen}
        saving={natalSaving}
        initialDate={profile?.birth_date}
        initialTime={profile?.birth_time}
        initialPlace={profile?.birth_place}
        onClose={() => setNatalModalOpen(false)}
        onSubmit={onSaveNatal}
      />
      {upgradeFeature ? (
        <AccountGateDialog
          visible
          feature={upgradeFeature}
          onClose={() => setUpgradeFeature(null)}
        />
      ) : null}
    </TabScreenLayout>
    </DonutVisibilityProvider>
  );
}

const styles = StyleSheet.create({
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
    borderRadius: SURFACE_CARD.borderRadius,
    borderWidth: SURFACE_CARD.borderWidth,
    gap: SURFACE_CARD.gap,
    padding: SURFACE_CARD.padding,
  },
  localeCard: {
    overflow: "visible",
    position: "relative",
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
});
