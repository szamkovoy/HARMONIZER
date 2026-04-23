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
    setErrorText(null);
    setBusy(true);
    try {
      const tz = getDeviceTimeZone();
      let lat: number | null = null;
      let lon: number | null = null;
      let locationName: string | null = null;

      if (opts.withLocation) {
        const perm = await Location.requestForegroundPermissionsAsync();
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
          backgroundColor: theme.colors.screenBg,
          paddingTop: insets.top + 32,
          paddingBottom: insets.bottom + 24,
        },
      ]}
    >
      <View style={styles.header}>
        <AppText variant="screenTitle">Добро пожаловать</AppText>
        <AppText
          variant="screenHint"
          style={{ color: theme.colors.textMuted, marginTop: 12 }}
        >
          Чтобы корректно показывать окна возможностей — восходы Солнца, Луны и
          планет — нам нужно знать, где вы находитесь. Координаты сохраняются
          только в вашем профиле.
        </AppText>
      </View>

      <View style={styles.actions}>
        <AppButton
          label={busy ? "Определение координат…" : "Разрешить геолокацию"}
          onPress={() => finish({ withLocation: true })}
          disabled={busy}
        />
        <AppButton
          label="Продолжить без геолокации"
          variant="secondary"
          onPress={() => finish({ withLocation: false })}
          disabled={busy}
        />
        {busy && (
          <View style={{ alignItems: "center", paddingTop: 8 }}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        )}
        {errorText && (
          <AppText
            variant="technicalCaption"
            style={{ color: theme.colors.danger, textAlign: "center" }}
          >
            {errorText}
          </AppText>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: "space-between",
  },
  header: {
    alignItems: "center",
  },
  actions: {
    gap: 12,
  },
});
