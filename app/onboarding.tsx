/**
 * Шаги 2-7 онбординг-мастера + финальный прогрев.
 *
 *   2. «Настройка навигатора архетипов» — дата/время/место рождения + геолокация
 *      (без доступа к геолокации дальше не пускаем).
 *   3. «От астрологии к психологии»   — intro (psycho.png)
 *   4. «От психологии к йоге»         — intro (asanas.png)
 *   5. «От тела к дыханию»            — intro (breath.png)
 *   6. «Живая поддержка»              — intro (webinar.png)
 *   7. «Об авторе»                    — intro (me.png)
 *   warm — только если к концу шага 7 ещё нет слогана + короткой рекомендации.
 *
 * Прогрев стартует сразу после шага 2 (`forceRefresh` + до 90s): пока пользователь
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
  BackHandler,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type ImageSourcePropType,
} from "react-native";
import * as Location from "expo-location";

import { accessModeForTier, getEffectiveAccess } from "@/modules/access";
import { useTranslate, getResponseLocale, type AppLocale } from "@/modules/i18n";
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
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { useAuth } from "@/modules/auth";
import { createNatalProfile } from "@/services/natalProfileClient";
import {
  fetchDailyForecast,
  ONBOARDING_DAILY_FORECAST_TIMEOUT_MS,
} from "@/services/dailyForecastClient";
import { saveDayContentCache } from "@/services/dayContentCache";
import { requireSupabase } from "@/services/supabase";
import { logRuntimeEvent, logRuntimeTap } from "@/services/runtimeDiagnostics";

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

function natalScopeKey(parts: { date: string; time: string; place: string }): string {
  const raw = [parts.date, parts.time, parts.place].join("|");
  return raw.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "default";
}

function contentScopeKey(accessMode: "free" | "premium", natalScope: string, locale: AppLocale): string {
  const base = accessMode === "free" ? "global" : natalScope;
  return `${base}:${locale}`;
}

/** Маска даты рождения: разделители «-» появляются сразу после 2-й цифры дня
 *  и сразу после 2-й цифры месяца («07-», затем «07-11-»). При удалении
 *  хвостовой разделитель не навязывается обратно (иначе backspace зациклится). */
function formatDateMask(raw: string, previous = ""): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  const prevDigits = previous.replace(/\D/g, "");
  const deleting = digits.length < prevDigits.length;
  if (digits.length === 0) return "";
  if (digits.length <= 2) {
    return digits.length === 2 && !deleting ? `${digits}-` : digits;
  }
  if (digits.length <= 4) {
    const body = `${digits.slice(0, 2)}-${digits.slice(2)}`;
    return digits.length === 4 && !deleting ? `${body}-` : body;
  }
  return `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
}
/** Маска времени: «:» сразу после 2-й цифры часа («12:»). При удалении
 *  хвостовое двоеточие не навязывается обратно. */
function formatTimeMask(raw: string, previous = ""): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  const prevDigits = previous.replace(/\D/g, "");
  const deleting = digits.length < prevDigits.length;
  if (digits.length === 0) return "";
  if (digits.length <= 2) {
    return digits.length === 2 && !deleting ? `${digits}:` : digits;
  }
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}
/** «DD-MM-YYYY» → «YYYY-MM-DD» (для API/БД) или null, если невалидно. */
function ddmmyyyyToIso(value: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value);
  if (!m) return null;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const iso = `${yyyy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00Z`);
  if (d.getUTCMonth() + 1 !== mm || d.getUTCDate() !== dd || d.getUTCFullYear() !== yyyy) return null;
  return iso;
}
/** «YYYY-MM-DD» (из БД) → «DD-MM-YYYY» (для поля ввода). */
function isoToDdmmyyyy(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Восстановительный режим: у пользователя уже есть onboarded_at, но данные рождения
 *  неполны (краевой сбой). В этом режиме после шага 2 мастер обрывается и ведёт на главную,
 *  без интро-экранов 3-7 и прогрева. Для первого входа (onboarded_at нет) — полный мастер. */
function isRepairMode(profile: { onboarded_at?: string | null } | null): boolean {
  return Boolean(typeof profile?.onboarded_at === "string" && profile.onboarded_at.trim());
}

export default function OnboardingScreen() {
  const theme = useTheme();
  const { t } = useTranslate();
  const { authUser, profile, refreshProfile, signOut } = useAuth();

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
  const [geoDenied, setGeoDenied] = useState(false);
  const [geoCanAskAgain, setGeoCanAskAgain] = useState(true);
  const [showPlaceMap, setShowPlaceMap] = useState(false);

  // ── Прогрев ──────────────────────────────────────────────────────────────
  /** Promise прогрева (forceRefresh + LLM). null, пока не стартовали после гео. */
  const forecastPromiseRef = useRef<Promise<boolean> | null>(null);
  /** true, когда в ответе уже есть слоган + короткая рекомендация (и они в кэше). */
  const prefetchReadyRef = useRef(false);
  const warmStartedRef = useRef(false);
  /** Снимок birth-полей для ключа кэша дня (совпадает с Home scopeKey). */
  const birthScopeRef = useRef<{ date: string; time: string; place: string } | null>(null);

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
        const natalScope = birthScope
          ? natalScopeKey(birthScope)
          : natalScopeKey({
              date: profile?.birth_date ?? "",
              time: profile?.birth_time ?? "",
              place:
                typeof profile?.birth_place === "string"
                  ? profile.birth_place
                  : JSON.stringify(profile?.birth_place ?? null),
            });
        const scopeKey = contentScopeKey(accessMode, natalScope, locale);
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

  const saveBirth = useCallback(async (): Promise<boolean> => {
    if (birthSaved) return true;
    const normalizedDate = birthDate.trim();
    const normalizedTime = birthTime.trim();
    setError(null);
    const isoDate = ddmmyyyyToIso(normalizedDate);
    if (!isoDate) {
      setError(t("onboarding.birth.dateInvalid"));
      return false;
    }
    if (!/^\d{2}:\d{2}$/.test(normalizedTime)) {
      setError(t("onboarding.birth.timeInvalid"));
      return false;
    }
    const hh = Number(normalizedTime.slice(0, 2));
    const mm = Number(normalizedTime.slice(3, 5));
    if (hh > 23 || mm > 59) {
      setError(t("onboarding.birth.timeInvalid"));
      return false;
    }
    if (!birthPlace) {
      setError(t("onboarding.birth.placeMissing"));
      return false;
    }
    setBusy(true);
    try {
      const birthData: BirthData = {
        date: isoDate,
        time: normalizedTime,
        timeMode: "precise",
        location: { lat: birthPlace.lat, lng: birthPlace.lng, timezone: birthPlace.timezone },
      };
      const placeName = [birthPlace.name, birthPlace.region, birthPlace.country]
        .filter(Boolean)
        .join(", ");
      await createNatalProfile(birthData, undefined, { placeName });
      // Тот же JSON, что пишет POST /api/astro/natal в users.birth_place —
      // иначе Home не попадёт в ключ dayContentCache.
      birthScopeRef.current = {
        date: isoDate,
        time: normalizedTime,
        place: JSON.stringify({
          name: placeName,
          lat: birthPlace.lat,
          lon: birthPlace.lng,
          timezone: birthPlace.timezone,
        }),
      };
      await refreshProfile();
      setBirthSaved(true);
      return true;
    } catch (e) {
      logRuntimeEvent("onboarding_birth_error", {
        message: e instanceof Error ? e.message : String(e),
      }, "warn");
      setError(t("onboarding.birth.saveError"));
      return false;
    } finally {
      setBusy(false);
    }
  }, [birthDate, birthPlace, birthSaved, birthTime, refreshProfile, t]);

  const finishOnboarding = useCallback(async () => {
    if (!authUser) return;
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
  }, [authUser, refreshProfile]);

  const onCloseAppFromWizardGeo = useCallback(() => {
    logRuntimeEvent("onboarding_geo_close_app", {});
    if (Platform.OS === "android") {
      BackHandler.exitApp();
      return;
    }
    // iOS не даёт закрыть приложение — выходим из сессии, чтобы не крутить гейт.
    void signOut();
  }, [signOut]);

  const requestGeoAndProceed = useCallback(async () => {
    if (!authUser) return;
    setError(null);
    setBusy(true);
    logRuntimeEvent("location:permission_request", { source: "wizard_step2" });
    const perm = await Location.requestForegroundPermissionsAsync();
    logRuntimeEvent("location:permission_result", {
      status: perm.status,
      canAskAgain: perm.canAskAgain,
    });
    if (perm.status !== "granted") {
      // Остаёмся на шаге 2: без гео дальше не пускаем.
      setGeoDenied(true);
      setGeoCanAskAgain(perm.canAskAgain !== false);
      setBusy(false);
      return;
    }
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      let locationName: string | null = null;
      try {
        const places = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
        const first = places[0];
        if (first) locationName = [first.city, first.region, first.country].filter(Boolean).join(", ");
      } catch { /* не критично */ }
      const tz = getDeviceTimeZone();
      const supabase = requireSupabase();
      const { error: updErr } = await supabase
        .from("users")
        .update({ tz, lat, lon, location_name: locationName })
        .eq("id", authUser.id);
      if (updErr) throw updErr;
      setGeoDenied(false);
      if (repairMode) {
        // Восстановительный режим: данных рождения не хватало — после шага 2 сразу на главную,
        // без интро 3-7 и прогрева (прогноз загрузит сама главная).
        void finishOnboarding();
      } else {
        startForecastPrefetch({ lat, lng: lon, timezone: tz });
        setStep(3);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [authUser, finishOnboarding, repairMode, startForecastPrefetch]);

  const onStep2Next = useCallback(async () => {
    logRuntimeTap("wizard_step2_next", {});
    const ok = await saveBirth();
    if (!ok) return;
    await requestGeoAndProceed();
  }, [requestGeoAndProceed, saveBirth]);

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
            label={busy ? "…" : geoDenied ? t("home.geoGate.grantButton") : t("wizard.next")}
            onPress={() => void onStep2Next()}
            disabled={busy}
          />
          {geoDenied ? (
            <>
              {geoCanAskAgain ? null : (
                <AppButton
                  label={t("home.geoGate.openSettings")}
                  variant="secondary"
                  onPress={() => void Linking.openSettings()}
                />
              )}
              <AppButton
                label={t("home.geoGate.closeApp")}
                variant="secondary"
                onPress={onCloseAppFromWizardGeo}
              />
            </>
          ) : null}
        </View>
      );
    }
    if (step === "warm") return null;
    return (
      <View style={styles.footerGap}>
        <AppButton label={t("wizard.next")} onPress={goToNextIntro} />
      </View>
    );
  }, [step, busy, geoDenied, geoCanAskAgain, onStep2Next, onCloseAppFromWizardGeo, goToNextIntro, t]);

  return (
    <>
    <WizardShell
      totalSteps={TOTAL_WIZARD_STEPS}
      currentStep={typeof step === "number" ? step : TOTAL_WIZARD_STEPS}
      footer={footer}
      footerInContent={step === 2}
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
              placeholderTextColor={theme.colors.textFaint}
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
              editable={!busy}
              style={[styles.input, inputStyle(theme)]}
            />
            <AppText variant="technicalCaption" tone="muted">
              {t("onboarding.birth.timeLabel")}
            </AppText>
            <WizardTextInput
              value={birthTime}
              onChangeText={(v) => setBirthTime((prev) => formatTimeMask(v, prev))}
              placeholder="ЧЧ:ММ"
              placeholderTextColor={theme.colors.textFaint}
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
              editable={!busy}
              style={[styles.input, inputStyle(theme)]}
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

          {geoDenied ? (
            <View style={[styles.notice, { borderColor: theme.colors.surfaceBorder, backgroundColor: theme.colors.surface }]}>
              <AppText variant="sectionTitle" style={styles.noticeText}>
                {t("home.geoGate.title")}
              </AppText>
              <AppText variant="dialogBody" tone="muted" style={styles.noticeText}>
                {t("home.geoGate.message")}
              </AppText>
            </View>
          ) : null}

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

function inputStyle(theme: ReturnType<typeof useTheme>) {
  return {
    borderWidth: 1,
    borderRadius: theme.radius.md,
    borderColor: theme.colors.surfaceBorder,
    color: theme.colors.textPrimary,
  };
}

const styles = StyleSheet.create({
  contentTopGap: {
    paddingTop: 12,
  },
  form: {
    gap: 8,
    // Выше футера «Далее», чтобы абсолютный список городов из BirthPlacePicker
    // перекрывал соседний контент, а не рисовался под ним.
    zIndex: 10,
  },
  input: {
    height: 52,
    fontSize: 16,
    paddingHorizontal: 14,
  },
  notice: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  noticeText: {
    textAlign: "center",
  },
  settingsLink: {
    textAlign: "center",
    textDecorationLine: "underline",
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
