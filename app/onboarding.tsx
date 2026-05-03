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
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText } from "@/modules/ui/AppText";
import { AppButton } from "@/modules/ui/AppButton";
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
  const insets = useSafeAreaInsets();
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
          setErrorText(
            "Разрешение на геолокацию не получено. Вы можете продолжить без неё — и указать координаты позже в настройках.",
          );
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
    <View
      style={[
        styles.root,
        {
          backgroundColor: theme.colors.controlButtonBg,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
        },
      ]}
    >
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.screenBg,
            borderColor: theme.colors.surfaceBorder,
          },
        ]}
      >
        <View style={styles.header}>
          <AppText variant="sectionTitle" style={styles.centerText}>
            Геолокация
          </AppText>
          <AppText variant="screenHint" tone="muted" style={styles.centerText}>
            Чтобы показывать окна возможностей, нам нужны ваши координаты. Они сохраняются только в профиле.
          </AppText>
        </View>

        <View style={styles.actions}>
          <AppButton
            label={busy ? "Определяю…" : "Разрешить"}
            onPress={() => finish({ withLocation: true })}
            disabled={busy}
          />
          <AppButton
            label="Без геолокации"
            variant="secondary"
            onPress={() => finish({ withLocation: false })}
            disabled={busy}
          />
          {busy && (
            <View style={styles.loader}>
              <ActivityIndicator color={theme.colors.accent} />
            </View>
          )}
          {errorText && (
            <AppText variant="technicalCaption" style={[styles.centerText, { color: theme.colors.danger }]}>
              {errorText}
            </AppText>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  card: {
    borderRadius: 28,
    borderWidth: 1,
    gap: 22,
    maxWidth: 420,
    padding: 22,
    width: "100%",
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
