/**
 * Онбординг после первого входа.
 *
 * Главная задача — получить координаты пользователя и часовой пояс, записать
 * их в `public.users` и проставить `onboarded_at`. Без координат мы не сможем
 * корректно считать восходы/заходы Солнца, Луны и планет на клиенте.
 *
 * Поток:
 *   1. Показываем короткое объяснение, зачем нужна геолокация.
 *   2. По тапу «Разрешить» — `Location.requestForegroundPermissionsAsync()`.
 *   3. Если дали разрешение — `Location.getCurrentPositionAsync` +
 *      `reverseGeocodeAsync` для человекочитаемого имени (необязательно).
 *   4. Если отказали — даём «Продолжить без геолокации»: значения останутся
 *      null, на Home будем подсказывать включить вручную позже.
 *   5. Пишем строку в `public.users` (обновляем существующую — триггер уже
 *      создал её при регистрации). Выставляем `onboarded_at = now()` и
 *      `tz` = системный TZ устройства.
 */
import { useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import * as Location from "expo-location";

import { useAppLocale } from "@/modules/i18n";
import { getOnboardingStrings } from "@/modules/auth/i18n/authScreens";
import { AppText } from "@/modules/ui/AppText";
import { AppButton } from "@/modules/ui/AppButton";
import { FormScreenLayout } from "@/modules/ui/StackScreenLayout";
import { useTheme } from "@/modules/ui/theme";
import { useAuth } from "@/modules/auth";
import { requireSupabase } from "@/services/supabase";
import { logRuntimeEvent, logRuntimeTap } from "@/services/runtimeDiagnostics";

function getDeviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export default function OnboardingScreen() {
  const theme = useTheme();
  const { locale } = useAppLocale();
  const strings = getOnboardingStrings(locale);
  const { authUser, refreshProfile } = useAuth();

  const [busy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  async function finish(opts: { withLocation: boolean }) {
    if (!authUser) return;
    logRuntimeTap("onboarding_finish", { withLocation: opts.withLocation });
    setErrorText(null);
    setBusy(true);
    try {
      const tz = getDeviceTimeZone();
      let lat: number | null = null;
      let lon: number | null = null;
      let locationName: string | null = null;

      if (opts.withLocation) {
        logRuntimeEvent("location:permission_request", { source: "onboarding" });
        const perm = await Location.requestForegroundPermissionsAsync();
        logRuntimeEvent("location:permission_result", { status: perm.status, canAskAgain: perm.canAskAgain });
        if (perm.status !== "granted") {
          setErrorText(strings.deniedError);
          setBusy(false);
          return;
        }
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        logRuntimeEvent("location:current_position_ready", { accuracy: pos.coords.accuracy ?? null });
        lat = pos.coords.latitude;
        lon = pos.coords.longitude;

        try {
          const places = await Location.reverseGeocodeAsync({
            latitude: lat,
            longitude: lon,
          });
          const first = places[0];
          if (first) {
            locationName = [first.city, first.region, first.country]
              .filter(Boolean)
              .join(", ");
          }
        } catch {
          /* reverse geocode не критичен */
        }
      }

      const supabase = requireSupabase();
      const { error } = await supabase
        .from("users")
        .update({
          tz,
          lat,
          lon,
          location_name: locationName,
          onboarded_at: new Date().toISOString(),
        })
        .eq("id", authUser.id);
      if (error) throw error;

      await refreshProfile();
      // Роут-гейт сам пересчитает, куда вести пользователя — на home.
    } catch (e) {
      setErrorText(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormScreenLayout
      centered
      statusBarStyle={theme.scheme === "dark" ? "light" : "dark"}
      style={styles.root}
      cardStyle={styles.card}
    >
      <View style={styles.header}>
        <AppText variant="sectionTitle" style={styles.centerText}>
          {strings.title}
        </AppText>
        <AppText variant="screenHint" tone="muted" style={styles.centerText}>
          {strings.subtitle}
        </AppText>
      </View>

      <View style={styles.actions}>
        <AppButton
          label={busy ? "…" : strings.allowButton}
          onPress={() => finish({ withLocation: true })}
          disabled={busy}
        />
        <AppButton
          label={strings.skipButton}
          variant="secondary"
          onPress={() => finish({ withLocation: false })}
          disabled={busy}
        />
        {busy ? (
          <View style={styles.loader}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        ) : null}
        {errorText ? (
          <AppText variant="technicalCaption" style={[styles.centerText, { color: theme.colors.danger }]}>
            {errorText}
          </AppText>
        ) : null}
      </View>
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
  header: {
    alignItems: "center",
    gap: 10,
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
});
