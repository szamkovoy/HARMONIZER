/**
 * Шаги 2-7 онбординг-мастера + финальный прогрев.
 *
 *   2. «Настройка навигатора архетипов» — дата/время/место рождения + запрос геолокации
 *      (отказ не блокирует переход — окна возможностей на главной покажут CTA).
 *   3. «От астрологии к психологии»   — intro (psycho.png)
 *   4. «От психологии к йоге»         — intro (asanas.png)
 *   5. «От тела к дыханию»            — intro (breath.png)
 *   6. «Живая поддержка»              — intro (webinar.png)
 *   7. «Об авторе»                    — intro (me.png)
 *   warm — только если к концу шага 7 ещё нет слогана + короткой рекомендации.
 *
 * Прогрев стартует сразу после сохранения натала на шаге 2 (`forceRefresh` + до 90s),
 * не дожидаясь GPS: отказ в геолокации не блокирует шаги 3–7. Пока пользователь
 * читает интро, сервер считает эфемериды и получает тексты от LLM. Готовый день
 * кладётся в dayContentCache. Если тексты готовы раньше — сразу главная;
 * иначе «Готовим ваш день», затем всё равно выход на главную по таймауту.
 *
 * Шаг 1 (вход) живёт на `/sign-in`; оба экрана используют общий `WizardShell`,
 * поэтому для пользователя это один непрерывный мастер.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type ImageSourcePropType,
} from "react-native";

import { accessModeForTier, getEffectiveAccess } from "@/modules/access";
import { useTranslate, getResponseLocale } from "@/modules/i18n";
import type { BirthData } from "@/modules/astro-core";
import type { DailyForecast } from "@/modules/daily-engine";
import {
  BirthPlacePicker,
  BirthPlaceMapModal,
  WizardBody,
  WizardImage,
  WizardShell,
  WizardTextInput,
  WizardTitle,
  type GeoPlace,
} from "@/modules/onboarding";
import { dayContentLocationFallback } from "@/modules/location/defaultDayContentLocation";
import {
  acquireAndPersistUserCoordinates,
  getOrRequestForegroundLocationPermission,
} from "@/modules/location/acquireAndPersistUserCoordinates";
import { notifyForegroundLocationPermissionChanged } from "@/modules/location/foregroundLocationEvents";
import {
  ddmmyyyyToIso,
  formatDateMask,
  formatTimeMask,
  isoToDdmmyyyy,
} from "@/modules/onboarding/birthDateFormat";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { buildTheme } from "@/modules/ui/theme";
import { useAuth } from "@/modules/auth";
import { useAppStartup } from "@/modules/bootstrap/AppStartupProvider";
import { createNatalProfile } from "@/services/natalProfileClient";
import {
  fetchDailyForecast,
  ONBOARDING_DAILY_FORECAST_TIMEOUT_MS,
} from "@/services/dailyForecastClient";
import { saveDayContentCache } from "@/services/dayContentCache";
import {
  dayContentLocaleScopeKey,
  dayContentNatalScopeKey,
} from "@/services/dayContentScope";
import { requireSupabase } from "@/services/supabase";
import { logRuntimeEvent, logRuntimeTap } from "@/services/runtimeDiagnostics";

/** Мастер всегда светлый (`WizardShell`); не брать системный dark theme с корня. */
const wizardTheme = buildTheme("light");

const TOTAL_WIZARD_STEPS = 7;
/** Ждём LLM-тексты дня не дольше этого; потом всё равно открываем главную. */
const WARMUP_TIMEOUT_MS = ONBOARDING_DAILY_FORECAST_TIMEOUT_MS;
const WARMUP_MIN_DISPLAY_MS = 1_200;

type Step = 2 | 3 | 4 | 5 | 6 | 7 | "warm";

type IntroDef = {
  image: ImageSourcePropType;
  titleKey: string;
  bodyKeys: string[];
};

const INTRO_STEPS: IntroDef[] = [
  { image: require("@/assets/onboarding/psycho_2_600.jpg"), titleKey: "wizard.step3.title", bodyKeys: ["wizard.step3.body1", "wizard.step3.body2", "wizard.step3.body3"] },
  { image: require("@/assets/onboarding/asanas_600.jpg"), titleKey: "wizard.step4.title", bodyKeys: ["wizard.step4.body1", "wizard.step4.body2", "wizard.step4.body3"] },
  { image: require("@/assets/onboarding/breath_2_600.jpg"), titleKey: "wizard.step5.title", bodyKeys: ["wizard.step5.body1", "wizard.step5.body2", "wizard.step5.body3"] },
  { image: require("@/assets/onboarding/webinar_600.jpg"), titleKey: "wizard.step6.title", bodyKeys: ["wizard.step6.body1", "wizard.step6.body2", "wizard.step6.body3"] },
  { image: require("@/assets/onboarding/me_600.jpg"), titleKey: "wizard.step7.title", bodyKeys: ["wizard.step7.body1", "wizard.step7.body2", "wizard.step7.body3", "wizard.step7.body4"] },
];

function getDeviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function localDateIso(timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

/** Слоган + короткая рекомендация — минимум для заполненной карточки на главной. */
function hasHomeCardTexts(forecast: DailyForecast): boolean {
  return Boolean(forecast.slogan?.trim() && forecast.recommendationShortText?.trim());
}

/** Восстановительный режим: у пользователя уже есть onboarded_at, но данные рождения
 *  неполны (краевой сбой). В этом режиме после шага 2 мастер обрывается и ведёт на главную,
 *  без интро-экранов 3-7 и прогрева. Для первого входа (onboarded_at нет) — полный мастер. */
function isRepairMode(profile: { onboarded_at?: string | null } | null): boolean {
  return Boolean(typeof profile?.onboarded_at === "string" && profile.onboarded_at.trim());
}

export default function OnboardingScreen() {
  const theme = wizardTheme;
  const { t } = useTranslate();
  const { authUser, profile, refreshProfile } = useAuth();
  const { forceNextHomeBootstrapSplash } = useAppStartup();

  const repairMode = isRepairMode(profile);
  // В онбординг попадаем только при неполных данных рождения (роут-гейт в _layout.tsx).
  // Поэтому всегда стартуем с шага 2; предзаполнение из профиля ускорит ремонт.
  const [step, setStep] = useState<Step>(2);

  // ── Шаг 2: данные рождения ──────────────────────────────────────────────
  // В поле даты показываем маску DD-MM-YYYY; в БД/API храним YYYY-MM-DD.
  const [birthDate, setBirthDate] = useState(isoToDdmmyyyy(profile?.birth_date ?? ""));
  const [birthTime, setBirthTime] = useState(profile?.birth_time ?? "");
  const [birthPlace, setBirthPlace] = useState<GeoPlace | null>(null);
  const [birthSaved, setBirthSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPlaceMap, setShowPlaceMap] = useState(false);

  // ── Прогрев ──────────────────────────────────────────────────────────────
  /** Promise прогрева (forceRefresh + LLM). null, пока натал ещё не сохранён. */
  const forecastPromiseRef = useRef<Promise<boolean> | null>(null);
  /** true, когда в ответе уже есть слоган + короткая рекомендация (и они в кэше). */
  const prefetchReadyRef = useRef(false);
  const warmStartedRef = useRef(false);
  /** Снимок birth-полей для ключа кэша дня (совпадает с Home scopeKey). */
  const birthScopeRef = useRef<{
    date: string;
    time: string;
    place: { name: string; lat: number; lon: number; timezone: string };
  } | null>(null);

  const startForecastPrefetch = useCallback(
    (loc: { lat: number; lng: number; timezone: string }) => {
      if (forecastPromiseRef.current || !authUser) return;
      const userId = authUser.id;
      const locale = getResponseLocale();
      const birthScope = birthScopeRef.current;
      logRuntimeEvent("onboarding_warmup_prefetch_start", {
        timezone: loc.timezone,
        forceRefresh: true,
        timeoutMs: WARMUP_TIMEOUT_MS,
      });
      forecastPromiseRef.current = (async () => {
        const result = await fetchDailyForecast({
          userLocation: loc,
          responseLocale: locale,
          forceRefresh: true,
          timeoutMs: WARMUP_TIMEOUT_MS,
        });
        const ready = hasHomeCardTexts(result.forecast);
        const access = getEffectiveAccess({
          membership_tier: profile?.membership_tier,
          trial_expires_at: profile?.trial_expires_at,
          membership_expires_at: profile?.membership_expires_at,
        });
        const accessMode = accessModeForTier(access.tier);
        const accessTier = access.tier;
        const natalScope = dayContentNatalScopeKey(
          birthScope
            ? {
                birth_date: birthScope.date,
                birth_time: birthScope.time,
                birth_place: birthScope.place,
              }
            : {
                birth_date: profile?.birth_date,
                birth_time: profile?.birth_time,
                birth_place: profile?.birth_place,
              },
        );
        const scopeKey = dayContentLocaleScopeKey(accessMode, natalScope, locale);
        const forecastDate = localDateIso(loc.timezone);
        try {
          await saveDayContentCache({
            userId,
            accessMode,
            accessTier,
            forecastDate,
            scopeKey,
            userLocation: loc,
            content: {
              forecast: result.forecast,
              source: result.source,
              modelUsed: result.modelUsed,
            },
          });
        } catch (cacheErr) {
          logRuntimeEvent(
            "onboarding_warmup_cache_error",
            { message: cacheErr instanceof Error ? cacheErr.message : String(cacheErr) },
            "warn",
          );
        }
        prefetchReadyRef.current = ready;
        logRuntimeEvent("onboarding_warmup_prefetch_result", {
          ready,
          hasSlogan: Boolean(result.forecast.slogan?.trim()),
          hasShort: Boolean(result.forecast.recommendationShortText?.trim()),
          modelUsed: result.modelUsed ?? "unknown",
        });
        return ready;
      })().catch((e) => {
        logRuntimeEvent(
          "onboarding_warmup_prefetch_error",
          { message: e instanceof Error ? e.message : String(e) },
          "warn",
        );
        return false;
      });
    },
    [authUser, profile?.birth_date, profile?.birth_place, profile?.birth_time, profile?.membership_expires_at, profile?.membership_tier, profile?.trial_expires_at],
  );

  const validateBirthFields = useCallback((): {
    isoDate: string;
    normalizedTime: string;
    place: GeoPlace;
    placeName: string;
  } | null => {
    const normalizedDate = birthDate.trim();
    const normalizedTime = birthTime.trim();
    setError(null);
    const isoDate = ddmmyyyyToIso(normalizedDate);
    if (!isoDate) {
      setError(t("onboarding.birth.dateInvalid"));
      return null;
    }
    if (!/^\d{2}:\d{2}$/.test(normalizedTime)) {
      setError(t("onboarding.birth.timeInvalid"));
      return null;
    }
    const hh = Number(normalizedTime.slice(0, 2));
    const mm = Number(normalizedTime.slice(3, 5));
    if (hh > 23 || mm > 59) {
      setError(t("onboarding.birth.timeInvalid"));
      return null;
    }
    if (!birthPlace) {
      setError(t("onboarding.birth.placeMissing"));
      return null;
    }
    const placeName = [birthPlace.name, birthPlace.region, birthPlace.country]
      .filter(Boolean)
      .join(", ");
    return { isoDate, normalizedTime, place: birthPlace, placeName };
  }, [birthDate, birthPlace, birthTime, t]);

  const finishOnboarding = useCallback(async () => {
    if (!authUser) return;
    // Полная заставка Home вместо day_card поверх недогруженной главной.
    forceNextHomeBootstrapSplash();
    try {
      const supabase = requireSupabase();
      const { error: err } = await supabase
        .from("users")
        .update({ onboarded_at: new Date().toISOString() })
        .eq("id", authUser.id);
      if (err) throw err;
    } catch (e) {
      logRuntimeEvent("onboarding_finish_error", {
        message: e instanceof Error ? e.message : String(e),
      }, "warn");
    }
    await refreshProfile().catch(() => undefined);
  }, [authUser, forceNextHomeBootstrapSplash, refreshProfile]);

  /**
   * Шаг 2 → 3: natal + запрос гео параллельно. Отказ не блокирует мастер.
   * Prefetch дня стартует сразу после натала (координаты места рождения —
   * те же, что natal пишет в users.lat при пустом GPS), без ожидания
   * getCurrentPosition. GPS, если granted, пишется в фоне.
   */
  const onStep2Next = useCallback(async () => {
    logRuntimeTap("wizard_step2_next", {});
    if (!authUser) return;

    const prefetchFromBirthPlace = (place: {
      lat: number;
      lng: number;
      timezone: string;
    }) => {
      startForecastPrefetch({
        lat: place.lat,
        lng: place.lng,
        timezone: place.timezone?.trim() || getDeviceTimeZone(),
      });
    };

    const continueWizard = () => {
      if (repairMode) {
        void finishOnboarding();
        return;
      }
      setStep(3);
    };

    const requestGeoPermission = async (source: "wizard_step2" | "wizard_step2_retry") => {
      logRuntimeEvent("location:permission_request", { source });
      try {
        const perm = await getOrRequestForegroundLocationPermission({ userInitiated: true });
        logRuntimeEvent("location:permission_result", {
          status: perm.status,
          canAskAgain: perm.canAskAgain,
        });
        notifyForegroundLocationPermissionChanged();
        if (perm.status === "granted") {
          void acquireAndPersistUserCoordinates(authUser.id);
        }
        return perm.status === "granted";
      } catch (e) {
        logRuntimeEvent(
          "location:permission_request_error",
          { source, message: e instanceof Error ? e.message : String(e) },
          "warn",
        );
        notifyForegroundLocationPermissionChanged();
        return false;
      }
    };

    if (birthSaved) {
      setBusy(true);
      setError(null);
      try {
        const scope = birthScopeRef.current;
        if (!repairMode) {
          prefetchFromBirthPlace(
            scope
              ? { lat: scope.place.lat, lng: scope.place.lon, timezone: scope.place.timezone }
              : dayContentLocationFallback(getDeviceTimeZone()),
          );
        }
        await requestGeoPermission("wizard_step2_retry");
        continueWizard();
        void refreshProfile().catch(() => undefined);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        continueWizard();
      } finally {
        setBusy(false);
      }
      return;
    }

    const fields = validateBirthFields();
    if (!fields) return;

    setBusy(true);
    setError(null);
    const { isoDate, normalizedTime, place, placeName } = fields;
    const birthData: BirthData = {
      date: isoDate,
      time: normalizedTime,
      timeMode: "precise",
      location: { lat: place.lat, lng: place.lng, timezone: place.timezone },
    };
    birthScopeRef.current = {
      date: isoDate,
      time: normalizedTime,
      place: {
        name: placeName,
        lat: place.lat,
        lon: place.lng,
        timezone: place.timezone,
      },
    };

    const natalPromise = createNatalProfile(birthData, undefined, { placeName });
    void natalPromise
      .then(() => {
        setBirthSaved(true);
        if (!repairMode) prefetchFromBirthPlace(place);
      })
      .catch(() => undefined);
    const permPromise = requestGeoPermission("wizard_step2");

    try {
      const [natalSettled] = await Promise.allSettled([natalPromise, permPromise]);
      if (natalSettled.status === "rejected") {
        throw natalSettled.reason;
      }
      continueWizard();
      void refreshProfile().catch(() => undefined);
    } catch (e) {
      logRuntimeEvent("onboarding_birth_error", {
        message: e instanceof Error ? e.message : String(e),
      }, "warn");
      setError(
        e instanceof Error && /natal|astro|birth/i.test(e.message)
          ? t("onboarding.birth.saveError")
          : e instanceof Error
            ? e.message
            : t("onboarding.birth.saveError"),
      );
    } finally {
      setBusy(false);
    }
  }, [
    authUser,
    birthSaved,
    finishOnboarding,
    refreshProfile,
    repairMode,
    startForecastPrefetch,
    t,
    validateBirthFields,
  ]);

  const goToNextIntro = useCallback(() => {
    setStep((s) => {
      if (typeof s === "number" && s < 7) return (s + 1) as Step;
      // После шага 7: если тексты уже готовы — сразу на главную, без «Готовим ваш день».
      if (prefetchReadyRef.current) {
        queueMicrotask(() => void finishOnboarding());
        return s;
      }
      return "warm";
    });
  }, [finishOnboarding]);

  // Прогрев: ждём prefetch (forceRefresh + LLM), запущенный после шага 2.
  // Таймаут HTTP уже 90s; safety на экране — на случай, если promise так и не стартовал.
  useEffect(() => {
    if (step !== "warm" || warmStartedRef.current) return;
    warmStartedRef.current = true;
    const startedAt = Date.now();
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      const waitLeft = Math.max(0, WARMUP_MIN_DISPLAY_MS - (Date.now() - startedAt));
      setTimeout(() => void finishOnboarding(), waitLeft);
    };
    const timeoutId = setTimeout(() => {
      logRuntimeEvent("onboarding_warmup_timeout", { ready: prefetchReadyRef.current }, "warn");
      finish();
    }, WARMUP_TIMEOUT_MS);
    void (async () => {
      try {
        const ready = await forecastPromiseRef.current;
        logRuntimeEvent("onboarding_warmup_prefetch_done", {
          elapsedMs: Date.now() - startedAt,
          ready: Boolean(ready),
        });
      } finally {
        clearTimeout(timeoutId);
        finish();
      }
    })();
    return () => clearTimeout(timeoutId);
  }, [finishOnboarding, step]);

  const footer = useMemo(() => {
    if (step === 2) {
      return (
        <View style={styles.footerGap}>
          <AppButton
            label={busy ? t("wizard.nextLoading") : t("wizard.next")}
            onPress={() => void onStep2Next()}
            disabled={busy}
          />
        </View>
      );
    }
    if (step === "warm") return null;
    return (
      <View style={styles.footerGap}>
        <AppButton label={t("wizard.next")} onPress={goToNextIntro} />
      </View>
    );
  }, [step, busy, onStep2Next, goToNextIntro, t]);

  return (
    <>
    <WizardShell
      totalSteps={TOTAL_WIZARD_STEPS}
      currentStep={typeof step === "number" ? step : TOTAL_WIZARD_STEPS}
      footer={footer}
      footerInContent={step === 2}
      // PLACE_FOCUS_SCROLL_EXTRA (2026-07-24): нюдж при выборе места / кнопке карты.
      contentBumpKey={step === 2 && birthPlace ? birthPlace.id : null}
      // Небольшой зазор между индикатором прогресса и картинкой (шаги 2–7).
      // На /sign-in (имя/email и OTP) отступ не добавляем — там уже отлажено.
      contentStyle={styles.contentTopGap}
    >
      {step === 2 ? (
        <>
          <WizardImage source={require("@/assets/onboarding/astrology_600.jpg")} />
          <WizardTitle>{t("wizard.step2.title")}</WizardTitle>
          <WizardBody>{t("wizard.step2.body")}</WizardBody>

          <View style={styles.form}>
            <AppText variant="technicalCaption" tone="muted">
              {t("onboarding.birth.dateLabel")}
            </AppText>
            <WizardTextInput
              value={birthDate}
              onChangeText={(v) => setBirthDate((prev) => formatDateMask(v, prev))}
              placeholder="ДД-ММ-ГГГГ"
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
              editable={!busy}
            />
            <AppText variant="technicalCaption" tone="muted">
              {t("onboarding.birth.timeLabel")}
            </AppText>
            <WizardTextInput
              value={birthTime}
              onChangeText={(v) => setBirthTime((prev) => formatTimeMask(v, prev))}
              placeholder="ЧЧ:ММ"
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
              editable={!busy}
            />
            <AppText variant="technicalCaption" tone="muted">
              {t("onboarding.birth.placeLabel")}
            </AppText>
            <BirthPlacePicker value={birthPlace} onSelect={setBirthPlace} disabled={busy} />
            {birthPlace ? (
              <Pressable
                onPress={() => setShowPlaceMap(true)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.mapButton,
                  { borderColor: theme.colors.accent, opacity: pressed ? 0.6 : 1 },
                ]}
              >
                <AppText variant="technicalCaption" tone="accent" style={styles.mapButtonText}>
                  {t("wizard.placeMap.open")}
                </AppText>
              </Pressable>
            ) : null}
          </View>

          {error ? (
            <AppText variant="technicalCaption" style={{ color: theme.colors.danger, textAlign: "center" }}>
              {error}
            </AppText>
          ) : null}
        </>
      ) : step === "warm" ? (
        <View style={styles.warmCard}>
          <ActivityIndicator size="large" color={theme.colors.accent} />
          <AppText variant="sectionTitle" style={{ textAlign: "center" }}>
            {t("wizard.warm.title")}
          </AppText>
          <AppText variant="screenHint" tone="muted" style={{ textAlign: "center" }}>
            {t("wizard.warm.body")}
          </AppText>
        </View>
      ) : (
        <IntroStep step={step} />
      )}
    </WizardShell>
    {showPlaceMap && birthPlace ? (
      <BirthPlaceMapModal place={birthPlace} onClose={() => setShowPlaceMap(false)} />
    ) : null}
    </>
  );
}

function IntroStep({ step }: { step: 3 | 4 | 5 | 6 | 7 }) {
  const { t } = useTranslate();
  const def = INTRO_STEPS[step - 3];
  return (
    <>
      <WizardImage source={def.image} />
      <WizardTitle>{t(def.titleKey)}</WizardTitle>
      {def.bodyKeys.map((k) => (
        <WizardBody key={k}>{t(k)}</WizardBody>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  contentTopGap: {
    paddingTop: 12,
  },
  form: {
    gap: 8,
  },
  mapButton: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 4,
  },
  mapButtonText: {
    fontWeight: "600",
  },
  footerGap: {
    gap: 12,
  },
  warmCard: {
    alignItems: "center",
    gap: 16,
    paddingVertical: 24,
  },
});
