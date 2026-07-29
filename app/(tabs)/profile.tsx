import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { router } from "expo-router";

import {
  AccountGateDialog,
  useAccess,
  type FeatureKey,
} from "@/modules/access";
import { deleteAccountRemote, openAccountCabinet, useAccountLinksEnabled } from "@/modules/account";
import { useAuth } from "@/modules/auth";
import { DonutVisibilityProvider, useDonutScrollProps, useDonutVisibilityRefresh } from "@/modules/charts";
import { APP_LOCALE_OPTIONS, getResponseLocale, useAppLocale, useTranslate, t as translate, type AppLocale } from "@/modules/i18n";
import type { BirthData } from "@/modules/astro-core";
import { NatalBirthDataModal, geoPlaceFromProfileBirthPlace } from "@/modules/home/ui/NatalBirthDataModal";
import { BirthPlaceMapModal, LegalFooter, formatGeoPlaceLabel, type GeoPlace } from "@/modules/onboarding";
import { isoToDdmmyyyy } from "@/modules/onboarding/birthDateFormat";
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
import { useTheme, type PaletteScheme } from "@/modules/ui/theme";
import { useThemePreference } from "@/modules/ui/themePreference";
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
import {
  clearRuntimeDiagnostics,
  logRuntimeEvent,
  logRuntimeTap,
  shareRuntimeDiagnosticsReport,
} from "@/services/runtimeDiagnostics";
import { markHomeDayContentBlockingReload } from "@/services/homeDayContentReloadRequest";
import { createNatalProfile } from "@/services/natalProfileClient";
import { clearDayContentCache } from "@/services/dayContentCache";
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
  const { authUser, profile, refreshProfile, signOut } = useAuth();
  const { access, canUseFeature } = useAccess();
  const { locale, setLocale, testMode } = useAppLocale();
  const { t } = useTranslate();
  const [localeOpen, setLocaleOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { scheme: paletteScheme, setScheme: setPaletteScheme } = useThemePreference();
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
          // Free: texts may already be in `warmed` while SecureStore peek lags.
          // Paid: do not silently force a second LLM/translate attempt — surface
          // the rebuild error dialog instead (avoids 2+ minute silent waits).
          if (!warmed) throw new Error(t("profile.language.rebuildError"));
          if (params.accessMode !== "free") {
            throw new Error(t("profile.language.rebuildError"));
          }
        }

        // Hand off to Home before setAppLocale so Navigator paints texts immediately.
        publishLocaleDayContentWarm(warmed);
        commitLocale(params.code);
      } catch (error) {
        if (controller.signal.aborted) return;
        // Диалог всегда на целевом языке (как toast «Идёт перевод…»); технические
        // EN-сообщения вроде «timed out after 25s» пользователю не показываем.
        void error;
        setOptimisticLocale(null);
        setLocaleRebuild({
          phase: "error",
          pendingLocale: params.code,
          previousLocale: params.previousLocale,
          accessMode: params.accessMode,
          message: translate(params.code, "profile.language.rebuildError"),
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
  const [birthMapOpen, setBirthMapOpen] = useState(false);
  const [upgradeFeature, setUpgradeFeature] = useState<FeatureKey | null>(null);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [supportOpen, setSupportOpen] = useState(false);
  const [cabinetOpening, setCabinetOpening] = useState(false);
  const [cabinetError, setCabinetError] = useState<string | null>(null);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [accountActionBusy, setAccountActionBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const linksEnabled = useAccountLinksEnabled();

  // «Мои данные»: имя, тариф, email и (для тарифов с персональным прогнозом)
  // дата/время/место рождения в режиме просмотра. Поля рождения выводятся только
  // когда натальная карта реально используется (personal_daily_forecast) — т.е. не
  // для бесплатного «Навигатора»; демо-период (trial → master) и платные тарифы
  // показывают. Тариф — локализованное имя; для trial — «Демо».
  const showBirthData = canUseFeature("personal_daily_forecast");
  const tariffLabel = access.isTrial
    ? t("profile.myData.tariffTrial")
    : t(`tier.${access.tier}`);
  const displayName = profile?.display_name?.trim() || "";
  const email = authUser?.email?.trim() || "";
  const birthGeoPlace: GeoPlace | null = useMemo(
    () => geoPlaceFromProfileBirthPlace(profile?.birth_place),
    [profile?.birth_place],
  );
  const birthDateText = useMemo(() => {
    const formatted = isoToDdmmyyyy(profile?.birth_date);
    return formatted || t("profile.myData.notSet");
  }, [profile?.birth_date, t]);
  const birthTimeText = useMemo(() => {
    const raw = (profile?.birth_time ?? "").trim();
    // В БД время может храниться как «HH:MM:SS» — показываем только «HH:MM».
    const hhmm = raw.slice(0, 5);
    return /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : raw || t("profile.myData.notSet");
  }, [profile?.birth_time, t]);
  const birthPlaceText = birthGeoPlace ? formatGeoPlaceLabel(birthGeoPlace) : t("profile.myData.notSet");

  const onOpenCabinet = useCallback(async () => {
    logRuntimeTap("profile_open_cabinet", {});
    setCabinetError(null);
    setCabinetOpening(true);
    try {
      await openAccountCabinet();
    } catch (error) {
      // Технический текст (HTTP 503 / schema cache) пользователю не показываем;
      // деталь уже в runtimeDiagnostics (`cabinet:open_failed`).
      logRuntimeEvent(
        "profile:cabinet_error",
        { message: error instanceof Error ? error.message : String(error) },
        "warn",
      );
      setCabinetError("1");
    } finally {
      setCabinetOpening(false);
    }
  }, []);

  const onConfirmSignOut = useCallback(async () => {
    logRuntimeTap("profile_sign_out", {});
    setAccountActionBusy(true);
    try {
      setSignOutConfirmOpen(false);
      await signOut();
    } finally {
      setAccountActionBusy(false);
    }
  }, [signOut]);

  const onConfirmDeleteAccount = useCallback(async () => {
    logRuntimeTap("profile_delete_account", {});
    setDeleteError(null);
    setAccountActionBusy(true);
    try {
      await deleteAccountRemote();
      setDeleteConfirmOpen(false);
      await signOut();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error));
    } finally {
      setAccountActionBusy(false);
    }
  }, [signOut]);

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

  const paletteOptions = useMemo(
    () =>
      [
        { value: "light" as const, label: t("profile.palette.light") },
        { value: "dark" as const, label: t("profile.palette.dark") },
      ] satisfies { value: PaletteScheme; label: string }[],
    [t],
  );
  const paletteDisplayValue =
    paletteOptions.find((option) => option.value === paletteScheme)?.label ?? t("profile.palette.light");

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
        // createNatalProfile на сервере инвалидирует user_daily_forecasts +
        // scenario_cache morning_recommendation (иначе диаграмма новая, тексты старые).
        await createNatalProfile(birthData, undefined, { placeName });
        await refreshProfile();
        if (authUser?.id) {
          // Сбрасываем phone-кэш дня — иначе Home может показать старые слоган/рекомендацию.
          await clearDayContentCache({ userId: authUser.id }).catch(() => undefined);
        }
        // На Профиле спиннер не держим: форма закрывается сразу. Главная при
        // фокусе покажет оверлей («Готовим ваш день»), пока не будет готового
        // слогана+рекомендации. forceRefresh:true — страховка, если фоновый
        // ensure ещё не успел; если успел — Home подхватит warm/phone-cache
        // без повторного LLM (см. blockingReload early-return в useDayContent).
        markHomeDayContentBlockingReload({ forceRefresh: true });
        setNatalModalOpen(false);
        // Фоновый прогрев сразу после Save (не блокирует UI).
        if (authUser?.id) {
          void ensureLocaleDayContent({
            userId: authUser.id,
            locale: getResponseLocale(),
            accessMode: dayAccessMode,
            accessTier: dayContentAccessTier,
            userLocation: resolveUserLocation(),
            birthDate: birthData.date,
            birthTime: birthData.time,
            birthPlace: {
              name: placeName,
              lat: birthData.location.lat,
              lon: birthData.location.lng,
              timezone: birthData.location.timezone,
            },
            forceRefresh: true,
            forceStructuralRefresh: true,
          })
            .then((warmed) => publishLocaleDayContentWarm(warmed))
            .catch(() => undefined);
        }
      } catch (error) {
        const message = errorMessage(error, "Не удалось сохранить натальные данные.");
        Alert.alert("Ошибка сохранения", message);
      } finally {
        setNatalSaving(false);
      }
    },
    [authUser, dayAccessMode, dayContentAccessTier, refreshProfile, resolveUserLocation],
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

        <View
          style={[
            styles.card,
            styles.localeCard,
            { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder },
          ]}
        >
          <AppText variant="sectionTitle">{t("profile.myData.title")}</AppText>
          <AppText variant="dialogBody">
            {displayName
              ? `${displayName} / ${tariffLabel}`
              : tariffLabel}
          </AppText>
          {email ? <AppText variant="dialogBody" tone="muted">{email}</AppText> : null}

          <View style={styles.notificationsRow}>
            <AppText variant="dialogBody">{t("notifications.myDataLabel")} </AppText>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`${t("notifications.myDataLabel")} ${unreadNotifications}`}
              onPress={() => {
                setUnreadNotifications(0);
                router.push("/my-notifications" as never);
              }}
              hitSlop={8}
            >
              <AppText variant="dialogBody" style={[styles.accountLink, { color: theme.colors.accent }]}>
                {unreadNotifications}
              </AppText>
            </Pressable>
          </View>

          <AppText variant="dialogBody">{t("profile.language.appLabel")}</AppText>
          <ComboBox
            variant="pill"
            id="profile-locale"
            label={t("profile.language.appLabel")}
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

          <ComboBox
            variant="pill"
            id="profile-palette"
            label={t("profile.palette.label")}
            value={paletteScheme}
            displayValue={paletteDisplayValue}
            options={paletteOptions}
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            onChange={(value) => {
              setPaletteScheme(value === "dark" ? "dark" : "light");
              setPaletteOpen(false);
            }}
          />
          <ComboBoxDismissOverlay
            active={localeOpen || paletteOpen}
            onDismiss={() => {
              setLocaleOpen(false);
              setPaletteOpen(false);
            }}
          />

          {linksEnabled ? (
            <>
              <AppButton
                label={cabinetOpening ? "…" : t("gate.openCabinet")}
                onPress={() => void onOpenCabinet()}
                disabled={cabinetOpening || accountActionBusy}
              />
              {cabinetError ? (
                <AppText variant="technicalCaption" style={{ color: theme.colors.danger }}>
                  {t("gate.cabinetError")}
                </AppText>
              ) : null}
            </>
          ) : null}

          <View style={styles.accountLinksRow}>
            <Pressable
              accessibilityRole="link"
              onPress={() => setSignOutConfirmOpen(true)}
              disabled={accountActionBusy}
              hitSlop={8}
            >
              <AppText variant="screenHint" style={[styles.accountLink, { color: theme.colors.accent }]}>
                {t("profile.account.signOut")}
              </AppText>
            </Pressable>
            <AppText variant="screenHint" tone="muted">
              ·
            </AppText>
            <Pressable
              accessibilityRole="link"
              onPress={() => {
                setDeleteError(null);
                setDeleteConfirmOpen(true);
              }}
              disabled={accountActionBusy}
              hitSlop={8}
            >
              <AppText variant="screenHint" style={[styles.accountLink, { color: theme.colors.accent }]}>
                {t("profile.account.delete")}
              </AppText>
            </Pressable>
          </View>

          {showBirthData ? (
            <>
              <View style={styles.myDataSpacer} />
              <AppText variant="dialogBody">
                {`${t("profile.myData.birthDate")}: ${birthDateText}`}
              </AppText>
              <AppText variant="dialogBody">
                {`${t("profile.myData.birthTime")}: ${birthTimeText}`}
              </AppText>
              <AppText variant="dialogBody">
                {`${t("profile.myData.birthPlace")}: ${birthPlaceText}`}
              </AppText>
              <View style={styles.myDataBirthActions}>
                <AppButton
                  label={t("profile.myData.mapButton")}
                  variant="secondary"
                  onPress={() => setBirthMapOpen(true)}
                  disabled={!birthGeoPlace}
                  style={styles.myDataActionBtn}
                />
                <AppButton
                  label={t("profile.myData.editButton")}
                  onPress={openBirthEditor}
                  style={styles.myDataActionBtn}
                />
              </View>
            </>
          ) : null}
        </View>

        <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
          <AppText variant="sectionTitle">{t("support.title")}</AppText>
          <AppText variant="screenHint" tone="muted">
            {t("support.profileHint")}
          </AppText>
          <AppButton label={t("support.openButton")} variant="secondary" onPress={() => setSupportOpen(true)} />
        </View>

        <AppDialog
          visible={localeRebuild.phase === "confirm" || localeRebuild.phase === "error"}
          title={
            localeRebuild.phase === "confirm" || localeRebuild.phase === "error"
              ? translate(localeRebuild.pendingLocale, "profile.language.rebuildTitle")
              : t("profile.language.rebuildTitle")
          }
          message={
            localeRebuild.phase === "error"
              ? localeRebuild.message
              : localeRebuild.phase === "confirm"
                ? translate(localeRebuild.pendingLocale, "profile.language.rebuildMessage")
                : t("profile.language.rebuildMessage")
          }
          onRequestClose={cancelLocaleRebuild}
          actions={
            <>
              <AppButton
                label={
                  localeRebuild.phase === "confirm" || localeRebuild.phase === "error"
                    ? translate(localeRebuild.pendingLocale, "profile.language.rebuildCancel")
                    : t("profile.language.rebuildCancel")
                }
                variant="secondary"
                onPress={cancelLocaleRebuild}
              />
              <AppButton
                label={
                  localeRebuild.phase === "confirm" || localeRebuild.phase === "error"
                    ? translate(localeRebuild.pendingLocale, "profile.language.rebuildContinue")
                    : t("profile.language.rebuildContinue")
                }
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

        {HARMONIZER_TEST_MODE ? (
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

        {/* Те же юр. документы, что на шаге 1 мастера; Modal не сбрасывает скролл. */}
        <View style={styles.legalFooter}>
          <LegalFooter tone="links" />
        </View>
      </TabScrollView>

      <SupportModal visible={supportOpen} onClose={() => setSupportOpen(false)} />
      <AppDialog
        visible={signOutConfirmOpen}
        title={t("profile.account.signOutTitle")}
        message={t("profile.account.signOutMessage")}
        onRequestClose={() => {
          if (!accountActionBusy) setSignOutConfirmOpen(false);
        }}
        actions={
          <>
            <AppButton
              label={t("profile.account.signOutCancel")}
              variant="secondary"
              onPress={() => setSignOutConfirmOpen(false)}
              disabled={accountActionBusy}
            />
            <AppButton
              label={t("profile.account.signOutConfirm")}
              onPress={() => void onConfirmSignOut()}
              disabled={accountActionBusy}
            />
          </>
        }
      />
      <AppDialog
        visible={deleteConfirmOpen || Boolean(deleteError)}
        title={t("profile.account.deleteTitle")}
        message={deleteError ? t("profile.account.deleteError") : t("profile.account.deleteMessage")}
        onRequestClose={() => {
          if (accountActionBusy) return;
          setDeleteConfirmOpen(false);
          setDeleteError(null);
        }}
        actions={
          deleteError ? (
            <AppButton
              label={t("common.close")}
              variant="secondary"
              onPress={() => {
                setDeleteConfirmOpen(false);
                setDeleteError(null);
              }}
            />
          ) : (
            <>
              <AppButton
                label={t("profile.account.deleteCancel")}
                variant="secondary"
                onPress={() => setDeleteConfirmOpen(false)}
                disabled={accountActionBusy}
              />
              <AppButton
                label={accountActionBusy ? t("profile.account.deleteWorking") : t("profile.account.deleteConfirm")}
                onPress={() => void onConfirmDeleteAccount()}
                disabled={accountActionBusy}
              />
            </>
          )
        }
      />
      <NatalBirthDataModal
        visible={natalModalOpen}
        saving={natalSaving}
        initialDate={profile?.birth_date}
        initialTime={profile?.birth_time}
        initialPlace={profile?.birth_place}
        onClose={() => setNatalModalOpen(false)}
        onSubmit={onSaveNatal}
      />
      {birthMapOpen && birthGeoPlace ? (
        <BirthPlaceMapModal place={birthGeoPlace} onClose={() => setBirthMapOpen(false)} />
      ) : null}
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
  myDataSpacer: {
    height: 8,
  },
  accountLinksRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "center",
    paddingTop: 4,
  },
  accountLink: {
    textDecorationLine: "underline",
  },
  notificationsRow: {
    alignItems: "baseline",
    flexDirection: "row",
    flexWrap: "wrap",
  },
  myDataBirthActions: {
    flexDirection: "row",
    gap: 10,
    paddingTop: 4,
  },
  myDataActionBtn: {
    flex: 1,
  },
  legalFooter: {
    alignItems: "center",
    paddingBottom: 8,
    paddingTop: 4,
  },
});
