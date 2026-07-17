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
 *   warm — ждём готовности дневного прогноза (запущен в фоне после шага 2).
 *
 * Прогрев (ephemeris → LLM-тексты дня) стартует сразу после шага 2, чтобы пока
 * пользователь читал интро-экраны, сервер успел подготовить главную страницу.
 * Если к концу шага 7 прогноз ещё не готов — показываем экран с колесиком.
 * Когда готов — проставляем `onboarded_at`, роут-гейт уводит на главную.
 *
 * Шаг 1 (вход) живёт на `/sign-in`; оба экрана используют общий `WizardShell`,
 * поэтому для пользователя это один непрерывный мастер.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type ImageSourcePropType,
} from "react-native";
import * as Location from "expo-location";

import { useTranslate, getResponseLocale } from "@/modules/i18n";
import type { BirthData } from "@/modules/astro-core";
import {
  BirthPlacePicker,
  BirthPlaceMapModal,
  WizardBody,
  WizardImage,
  WizardShell,
  WizardTitle,
  type GeoPlace,
} from "@/modules/onboarding";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { useAuth } from "@/modules/auth";
import { createNatalProfile } from "@/services/natalProfileClient";
import { fetchDailyForecast } from "@/services/dailyForecastClient";
import { requireSupabase } from "@/services/supabase";
import { logRuntimeEvent, logRuntimeTap } from "@/services/runtimeDiagnostics";

const TOTAL_WIZARD_STEPS = 7;
const WARMUP_TIMEOUT_MS = 90_000;
const WARMUP_MIN_DISPLAY_MS = 1_200;

type Step = 2 | 3 | 4 | 5 | 6 | 7 | "warm";

type IntroDef = {
  image: ImageSourcePropType;
  titleKey: string;
  bodyKeys: string[];
};

const INTRO_STEPS: IntroDef[] = [
  { image: require("@/assets/onboarding/psycho_600.jpg"), titleKey: "wizard.step3.title", bodyKeys: ["wizard.step3.body"] },
  { image: require("@/assets/onboarding/asanas_600.jpg"), titleKey: "wizard.step4.title", bodyKeys: ["wizard.step4.body"] },
  { image: require("@/assets/onboarding/breath_600.jpg"), titleKey: "wizard.step5.title", bodyKeys: ["wizard.step5.body"] },
  { image: require("@/assets/onboarding/webinar_600.jpg"), titleKey: "wizard.step6.title", bodyKeys: ["wizard.step6.body"] },
  { image: require("@/assets/onboarding/me_600.jpg"), titleKey: "wizard.step7.title", bodyKeys: ["wizard.step7.body"] },
];

function getDeviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Маска даты рождения: пользователь вводит цифры, разделители «-» вставляются
 *  автоматически (как номер карты). Внутренне храним и показываем DD-MM-YYYY. */
function formatDateMask(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  let out = digits;
  if (digits.length > 2) out = digits.slice(0, 2) + "-" + digits.slice(2);
  if (digits.length > 4) out = digits.slice(0, 2) + "-" + digits.slice(2, 4) + "-" + digits.slice(4);
  return out;
}
/** Маска времени: «:» после двух цифр вставляется автоматически. */
function formatTimeMask(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? digits.slice(0, 2) + ":" + digits.slice(2) : digits;
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
  const { authUser, profile, refreshProfile } = useAuth();

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
  const [showPlaceMap, setShowPlaceMap] = useState(false);

  // ── Прогрев ──────────────────────────────────────────────────────────────
  const forecastPromiseRef = useRef<Promise<unknown> | null>(null);
  const warmStartedRef = useRef(false);

  const startForecastPrefetch = useCallback(
    (loc: { lat: number; lng: number; timezone: string }) => {
      if (forecastPromiseRef.current) return;
      logRuntimeEvent("onboarding_warmup_prefetch_start", { timezone: loc.timezone });
      forecastPromiseRef.current = fetchDailyForecast({
        userLocation: loc,
        responseLocale: getResponseLocale(),
      }).catch((e) => {
        logRuntimeEvent("onboarding_warmup_prefetch_error", {
          message: e instanceof Error ? e.message : String(e),
        }, "warn");
      });
    },
    [],
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
      await createNatalProfile(birthData, undefined, {
        placeName: [birthPlace.name, birthPlace.region, birthPlace.country].filter(Boolean).join(", "),
      });
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
      setGeoDenied(true);
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
    setStep((s) => (typeof s === "number" && s < 7 ? (s + 1) as Step : "warm"));
  }, []);

  // Прогрев: ждём prefetch, запущенный после шага 2.
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
      logRuntimeEvent("onboarding_warmup_timeout", {}, "warn");
      finish();
    }, WARMUP_TIMEOUT_MS);
    void (async () => {
      try {
        await forecastPromiseRef.current;
        logRuntimeEvent("onboarding_warmup_prefetch_done", { elapsedMs: Date.now() - startedAt });
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
            label={busy ? "…" : geoDenied ? t("wizard.geo.requestButton") : t("wizard.next")}
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
  }, [step, busy, geoDenied, onStep2Next, goToNextIntro, t]);

  return (
    <>
    <WizardShell
      totalSteps={TOTAL_WIZARD_STEPS}
      currentStep={typeof step === "number" ? step : TOTAL_WIZARD_STEPS}
      footer={footer}
      footerInContent={step === 2}
    >
      {step === 2 ? (
        <>
          <WizardImage source={require("@/assets/onboarding/astrology_600.jpg")} />
          <WizardTitle>{t("wizard.step2.title")}</WizardTitle>
          <WizardBody>{t("wizard.step2.body")}</WizardBody>

          {birthSaved ? null : (
            <View style={styles.form}>
              <AppText variant="technicalCaption" tone="muted">
                {t("onboarding.birth.dateLabel")}
              </AppText>
              <TextInput
                value={birthDate}
                onChangeText={(v) => setBirthDate(formatDateMask(v))}
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
              <TextInput
                value={birthTime}
                onChangeText={(v) => setBirthTime(formatTimeMask(v))}
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
              {/* Запас места под выпадающий список городов (оверлеит кнопку «Далее»). */}
              <View style={styles.placeSpacer} />
            </View>
          )}

          {geoDenied ? (
            <View style={[styles.notice, { borderColor: theme.colors.surfaceBorder, backgroundColor: theme.colors.surface }]}>
              <AppText variant="dialogBody" tone="muted" style={styles.noticeText}>
                {t("wizard.geo.permissionDenied")}
              </AppText>
              <Pressable onPress={() => void Linking.openSettings()} accessibilityRole="link">
                <AppText
                  variant="technicalCaption"
                  tone="accent"
                  style={styles.settingsLink}
                >
                  {t("wizard.geo.openSettings")}
                </AppText>
              </Pressable>
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
  form: {
    gap: 8,
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
  placeSpacer: {
    height: 72,
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
