/**
 * Онбординг после первого входа: три шага.
 *
 *   1. «Данные рождения» — дата, местное время и место рождения (строка с
 *      автодополнением города через Open-Meteo). Шаг пропускается, если в
 *      `users` уже есть birth_date (возвращающийся пользователь на новом
 *      устройстве). Сохранение = POST /api/astro/natal (натальная карта +
 *      birth_* поля профиля).
 *   2. «Геолокация» — текущие координаты для окон возможностей (восходы/заходы).
 *      Можно пропустить; тогда fallback — координаты места рождения.
 *   3. «Прогрев» — параллельно с экраном ожидания префетчим дневной прогноз
 *      (сервер прогревает LLM-тексты), чтобы главная открылась мгновенно.
 *      Каркас для будущих интро-экранов: сейчас — спиннер с сообщением.
 *
 * `onboarded_at` проставляется только в конце шага 3 — роут-гейт в
 * app/_layout.tsx после этого сам уводит на главную.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from "react-native";
import * as Location from "expo-location";

import { useAppLocale, useTranslate, getResponseLocale } from "@/modules/i18n";
import type { BirthData } from "@/modules/astro-core";
import { BirthPlacePicker, type GeoPlace } from "@/modules/onboarding";
import { AppText } from "@/modules/ui/AppText";
import { AppButton } from "@/modules/ui/AppButton";
import { FormScreenLayout } from "@/modules/ui/StackScreenLayout";
import { useTheme } from "@/modules/ui/theme";
import { useAuth } from "@/modules/auth";
import { createNatalProfile } from "@/services/natalProfileClient";
import { fetchDailyForecast } from "@/services/dailyForecastClient";
import { requireSupabase } from "@/services/supabase";
import { logRuntimeEvent, logRuntimeTap } from "@/services/runtimeDiagnostics";

type OnboardingStep = "birth" | "location" | "warm";

/** Прогрев не держим дольше этого времени — главная умеет дозагружаться сама. */
const WARMUP_TIMEOUT_MS = 90_000;
/** Минимальное время показа прогрева, чтобы экран не мигал. */
const WARMUP_MIN_DISPLAY_MS = 1_200;

function getDeviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function profileHasBirthData(profile: { birth_date?: string | null } | null): boolean {
  return Boolean(typeof profile?.birth_date === "string" && profile.birth_date.trim());
}

export default function OnboardingScreen() {
  const theme = useTheme();
  const { t } = useTranslate();
  const { locale } = useAppLocale();
  const { authUser, profile, refreshProfile } = useAuth();

  const [step, setStep] = useState<OnboardingStep>(() =>
    profileHasBirthData(profile) ? "location" : "birth",
  );

  // ── Шаг 1: данные рождения ──────────────────────────────────────────────
  const [birthDate, setBirthDate] = useState("");
  const [birthTime, setBirthTime] = useState("");
  const [birthPlace, setBirthPlace] = useState<GeoPlace | null>(null);
  const [birthSaving, setBirthSaving] = useState(false);
  const [birthError, setBirthError] = useState<string | null>(null);

  // ── Шаг 2: геолокация ───────────────────────────────────────────────────
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  // ── Шаг 3: прогрев ──────────────────────────────────────────────────────
  const warmStartedRef = useRef(false);
  /** Координаты для префетча прогноза: геолокация → место рождения → null. */
  const warmLocationRef = useRef<{ lat: number; lng: number; timezone: string } | null>(null);

  const submitBirth = useCallback(async () => {
    const normalizedDate = birthDate.trim();
    const normalizedTime = birthTime.trim();
    setBirthError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
      setBirthError(t("onboarding.birth.dateInvalid"));
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(normalizedTime)) {
      setBirthError(t("onboarding.birth.timeInvalid"));
      return;
    }
    if (!birthPlace) {
      setBirthError(t("onboarding.birth.placeMissing"));
      return;
    }
    logRuntimeTap("onboarding_birth_submit", { hasPlace: true });
    setBirthSaving(true);
    try {
      const birthData: BirthData = {
        date: normalizedDate,
        time: normalizedTime,
        timeMode: "precise",
        location: {
          lat: birthPlace.lat,
          lng: birthPlace.lng,
          timezone: birthPlace.timezone,
        },
      };
      await createNatalProfile(birthData, undefined, {
        placeName: [birthPlace.name, birthPlace.region, birthPlace.country].filter(Boolean).join(", "),
      });
      warmLocationRef.current = {
        lat: birthPlace.lat,
        lng: birthPlace.lng,
        timezone: birthPlace.timezone,
      };
      await refreshProfile();
      setStep("location");
    } catch (error) {
      logRuntimeEvent(
        "onboarding_birth_error",
        { message: error instanceof Error ? error.message : String(error) },
        "warn",
      );
      setBirthError(t("onboarding.birth.saveError"));
    } finally {
      setBirthSaving(false);
    }
  }, [birthDate, birthPlace, birthTime, refreshProfile, t]);

  const submitLocation = useCallback(
    async (opts: { withLocation: boolean }) => {
      if (!authUser) return;
      logRuntimeTap("onboarding_finish", { withLocation: opts.withLocation });
      setLocationError(null);
      setLocationBusy(true);
      try {
        const tz = getDeviceTimeZone();
        let lat: number | null = null;
        let lon: number | null = null;
        let locationName: string | null = null;

        if (opts.withLocation) {
          logRuntimeEvent("location:permission_request", { source: "onboarding" });
          const perm = await Location.requestForegroundPermissionsAsync();
          logRuntimeEvent("location:permission_result", {
            status: perm.status,
            canAskAgain: perm.canAskAgain,
          });
          if (perm.status !== "granted") {
            setLocationError(t("onboarding.location.denied"));
            setLocationBusy(false);
            return;
          }
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          logRuntimeEvent("location:current_position_ready", {
            accuracy: pos.coords.accuracy ?? null,
          });
          lat = pos.coords.latitude;
          lon = pos.coords.longitude;

          try {
            const places = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
            const first = places[0];
            if (first) {
              locationName = [first.city, first.region, first.country].filter(Boolean).join(", ");
            }
          } catch {
            /* reverse geocode не критичен */
          }
        }

        const supabase = requireSupabase();
        const { error } = await supabase
          .from("users")
          .update({ tz, lat, lon, location_name: locationName })
          .eq("id", authUser.id);
        if (error) throw error;

        if (lat != null && lon != null) {
          warmLocationRef.current = { lat, lng: lon, timezone: tz };
        }
        setStep("warm");
      } catch (e) {
        setLocationError(e instanceof Error ? e.message : String(e));
      } finally {
        setLocationBusy(false);
      }
    },
    [authUser, t],
  );

  const finishOnboarding = useCallback(async () => {
    if (!authUser) return;
    try {
      const supabase = requireSupabase();
      const { error } = await supabase
        .from("users")
        .update({ onboarded_at: new Date().toISOString() })
        .eq("id", authUser.id);
      if (error) throw error;
    } catch (error) {
      logRuntimeEvent(
        "onboarding_finish_error",
        { message: error instanceof Error ? error.message : String(error) },
        "warn",
      );
    }
    await refreshProfile().catch(() => undefined);
    // Роут-гейт в app/_layout.tsx сам уведёт на главную.
  }, [authUser, refreshProfile]);

  // Прогрев: префетч дневного прогноза параллельно с экраном ожидания.
  // Здесь позже появятся интро-экраны (контент пришлёт продукт) — каркас готов:
  // достаточно заменить WarmupCard на пейджер, finishOnboarding остаётся тем же.
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
        const location = warmLocationRef.current;
        if (location) {
          logRuntimeEvent("onboarding_warmup_prefetch_start", { timezone: location.timezone });
          await fetchDailyForecast({
            userLocation: location,
            responseLocale: getResponseLocale(),
          });
          logRuntimeEvent("onboarding_warmup_prefetch_done", {
            elapsedMs: Date.now() - startedAt,
          });
        }
      } catch (error) {
        logRuntimeEvent(
          "onboarding_warmup_prefetch_error",
          { message: error instanceof Error ? error.message : String(error) },
          "warn",
        );
      } finally {
        clearTimeout(timeoutId);
        finish();
      }
    })();

    return () => clearTimeout(timeoutId);
  }, [finishOnboarding, step]);

  return (
    <FormScreenLayout
      centered
      statusBarStyle={theme.scheme === "dark" ? "light" : "dark"}
      style={styles.root}
      cardStyle={styles.card}
    >
      {step === "birth" ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollContent}>
          <View style={styles.header}>
            <AppText variant="sectionTitle" style={styles.centerText}>
              {t("onboarding.birth.title")}
            </AppText>
            <AppText variant="screenHint" tone="muted" style={styles.centerText}>
              {t("onboarding.birth.subtitle")}
            </AppText>
          </View>

          <View style={styles.form}>
            <AppText variant="technicalCaption" tone="muted">
              {t("onboarding.birth.dateLabel")}
            </AppText>
            <TextInput
              value={birthDate}
              onChangeText={setBirthDate}
              placeholder="1985-04-23"
              placeholderTextColor={theme.colors.textFaint}
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
              editable={!birthSaving}
              style={[
                styles.input,
                { borderColor: theme.colors.surfaceBorder, color: theme.colors.textPrimary },
              ]}
            />
            <AppText variant="technicalCaption" tone="muted">
              {t("onboarding.birth.timeLabel")}
            </AppText>
            <TextInput
              value={birthTime}
              onChangeText={setBirthTime}
              placeholder="06:45"
              placeholderTextColor={theme.colors.textFaint}
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
              editable={!birthSaving}
              style={[
                styles.input,
                { borderColor: theme.colors.surfaceBorder, color: theme.colors.textPrimary },
              ]}
            />
            <AppText variant="technicalCaption" tone="muted">
              {t("onboarding.birth.placeLabel")}
            </AppText>
            <BirthPlacePicker value={birthPlace} onSelect={setBirthPlace} disabled={birthSaving} />
          </View>

          <View style={styles.actions}>
            <AppButton
              label={birthSaving ? t("onboarding.birth.saving") : t("onboarding.birth.continue")}
              onPress={() => void submitBirth()}
              disabled={birthSaving}
            />
            {birthSaving ? (
              <View style={styles.loader}>
                <ActivityIndicator color={theme.colors.accent} />
              </View>
            ) : null}
            {birthError ? (
              <AppText
                variant="technicalCaption"
                style={[styles.centerText, { color: theme.colors.danger }]}
              >
                {birthError}
              </AppText>
            ) : null}
          </View>
        </ScrollView>
      ) : null}

      {step === "location" ? (
        <>
          <View style={styles.header}>
            <AppText variant="sectionTitle" style={styles.centerText}>
              {t("onboarding.location.title")}
            </AppText>
            <AppText variant="screenHint" tone="muted" style={styles.centerText}>
              {t("onboarding.location.subtitle")}
            </AppText>
          </View>

          <View style={styles.actions}>
            <AppButton
              label={locationBusy ? "…" : t("onboarding.location.allow")}
              onPress={() => void submitLocation({ withLocation: true })}
              disabled={locationBusy}
            />
            <AppButton
              label={t("onboarding.location.skip")}
              variant="secondary"
              onPress={() => void submitLocation({ withLocation: false })}
              disabled={locationBusy}
            />
            {locationBusy ? (
              <View style={styles.loader}>
                <ActivityIndicator color={theme.colors.accent} />
              </View>
            ) : null}
            {locationError ? (
              <AppText
                variant="technicalCaption"
                style={[styles.centerText, { color: theme.colors.danger }]}
              >
                {locationError}
              </AppText>
            ) : null}
          </View>
        </>
      ) : null}

      {step === "warm" ? (
        <View style={styles.warmCard}>
          <ActivityIndicator size="large" color={theme.colors.accent} />
          <AppText variant="sectionTitle" style={styles.centerText}>
            {t("onboarding.warm.title")}
          </AppText>
          <AppText variant="screenHint" tone="muted" style={styles.centerText}>
            {t("onboarding.warm.body")}
          </AppText>
        </View>
      ) : null}
    </FormScreenLayout>
  );
}

const styles = StyleSheet.create({
  root: {
    justifyContent: "center",
  },
  card: {
    gap: 22,
  },
  scrollContent: {
    gap: 22,
  },
  header: {
    alignItems: "center",
    gap: 10,
  },
  form: {
    gap: 8,
  },
  input: {
    borderWidth: 1,
    borderRadius: 16,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  actions: {
    gap: 12,
  },
  centerText: {
    textAlign: "center",
  },
  loader: {
    alignItems: "center",
    paddingTop: 8,
  },
  warmCard: {
    alignItems: "center",
    gap: 16,
    paddingVertical: 24,
  },
});
