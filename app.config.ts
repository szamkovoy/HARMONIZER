/**
 * Динамический слой конфигурации Expo. Позволяет подставлять значения из
 * переменных окружения (EXPO_PUBLIC_*) во время prebuild — в чистом app.json
 * такого механизма нет.
 *
 * Expo читает app.config.ts (имеет приоритет) и мерджит с app.json. Здесь мы:
 *   1. Подтягиваем статическую часть из app.json.
 *   2. Добавляем `NSLocationWhenInUseUsageDescription` — чтобы иметь право
 *      спрашивать геолокацию на онбординге (для эфемерид: восходы Солнца/Луны
 *      зависят от точных координат пользователя).
 *
 * Авторизация — только email-OTP (Supabase): нативные плагины Apple/Google
 * Sign-In удалены вместе с их entitlement/URL-scheme (см. modules/auth).
 *
 * Никаких секретных значений в сам файл не кладём — только имена env-переменных.
 */
import type { ExpoConfig, ConfigContext } from "expo/config";
import appJson from "./app.json";

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = appJson.expo as ExpoConfig;

  return {
    ...base,
    ...config,
    ios: {
      ...base.ios,
      ...config.ios,
      infoPlist: {
        ...(base.ios?.infoPlist ?? {}),
        ...(config.ios?.infoPlist ?? {}),
        NSBluetoothAlwaysUsageDescription:
          "Harmonizer использует Bluetooth для подключения нагрудных пульсометров и синхронизации дыхательной практики с сердечным ритмом.",
        NSLocationWhenInUseUsageDescription:
          "Harmonizer использует геолокацию для точного расчёта астрономических окон возможностей — восходов/заходов Солнца, Луны и планет в вашем месте.",
      },
      entitlements: {
        ...((base.ios as { entitlements?: Record<string, boolean> } | undefined)?.entitlements ?? {}),
        ...((config.ios as { entitlements?: Record<string, boolean> } | undefined)?.entitlements ?? {}),
        /** Локальные уведомления с `interruptionLevel: timeSensitive` (напоминания о окнах). */
        "com.apple.developer.usernotifications.time-sensitive": true,
        "com.apple.developer.healthkit": true,
      },
    },
    android: {
      ...base.android,
      ...config.android,
      permissions: [
        ...new Set([
          ...((base.android as { permissions?: string[] } | undefined)?.permissions ?? []),
          ...((config.android as { permissions?: string[] } | undefined)?.permissions ?? []),
          "android.permission.BLUETOOTH",
          "android.permission.BLUETOOTH_ADMIN",
          "android.permission.BLUETOOTH_SCAN",
          "android.permission.BLUETOOTH_CONNECT",
          "android.permission.health.READ_STEPS",
          "android.permission.health.READ_ACTIVE_CALORIES_BURNED",
          "android.permission.health.READ_EXERCISE",
          "android.permission.health.READ_SLEEP",
        ]),
      ],
    },
    plugins: [
      ...(base.plugins ?? []),
      [
        "expo-build-properties",
        {
          android: {
            minSdkVersion: 26,
            compileSdkVersion: 35,
            targetSdkVersion: 35,
          },
        },
      ],
      [
        "@sfourdrinier/react-native-ble-plx",
        {
          neverForLocation: true,
          bluetoothAlwaysPermission:
            "Harmonizer использует Bluetooth для подключения совместимых нагрудных пульсометров и получения точных ударов R-R.",
        },
      ],
      "react-native-health-connect",
      "./plugins/with-native-health.js",
    ],
  };
};
