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
 *   3. Подключаем `android.googleServicesFile` для FCM (remote push):
 *      - локально: `./google-services.json` в корне (gitignore);
 *      - на EAS: file-env `GOOGLE_SERVICES_JSON` (путь подставляет билдер).
 *      Без этого Android не получает Expo push token → админ-пуши не уходят.
 *
 * Авторизация — только email-OTP (Supabase): нативные плагины Apple/Google
 * Sign-In удалены вместе с их entitlement/URL-scheme (см. modules/auth).
 *
 * Никаких секретных значений в сам файл не кладём — только имена env-переменных.
 */
import fs from "node:fs";
import path from "node:path";

import type { ExpoConfig, ConfigContext } from "expo/config";
import appJson from "./app.json";

/** EAS file env path, or local gitignored file for `eas build --local` / prebuild. */
const GOOGLE_SERVICES_FILE =
  (process.env.GOOGLE_SERVICES_JSON || "").trim() ||
  (fs.existsSync(path.join(__dirname, "google-services.json"))
    ? "./google-services.json"
    : "");
if (!GOOGLE_SERVICES_FILE) {
  console.warn(
    "[app.config] google-services.json missing — Android remote push will not register an Expo token until the file is present locally or as EAS env GOOGLE_SERVICES_JSON.",
  );
}
/** Maps SDK for Android (`react-native-maps` / BirthPlaceMapModal). iOS uses Apple Maps. */
const GOOGLE_MAPS_API_KEY = (
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  ""
).trim();
if (!GOOGLE_MAPS_API_KEY) {
  // Native Android builds without this crash MapView with "API key not found".
  // Local: `.env.local`. EAS: `eas env` → EXPO_PUBLIC_GOOGLE_MAPS_API_KEY (all envs).
  console.warn(
    "[app.config] EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is empty — Android BirthPlaceMapModal will crash until rebuild with the key.",
  );
}

/**
 * Локализованное имя приложения и reason-строки разрешений iOS.
 * См. `plugins/appLocalesData.js` — там карта `expo.locales`:
 *  - iOS: `<lang>.lproj/InfoPlist.strings` с `CFBundleDisplayName` + `NSXxxUsageDescription`.
 *  - Android: `res/values-<lang>/strings.xml` с `app_name` (манифест ссылается на `@string/app_name`).
 * `CFBundleLocalizations` в `ios.infoPlist` дополнительно декларирует поддерживаемые
 * локали, чтобы системные диалоги (напр. запрос уведомлений) шли на языке устройства.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { locales, LANGS } = require("./plugins/appLocalesData");

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = appJson.expo as ExpoConfig;

  return {
    ...base,
    ...config,
    locales,
    ios: {
      ...base.ios,
      ...config.ios,
      infoPlist: {
        ...(base.ios?.infoPlist ?? {}),
        ...(config.ios?.infoPlist ?? {}),
        CFBundleLocalizations: LANGS,
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
      ...(GOOGLE_SERVICES_FILE ? { googleServicesFile: GOOGLE_SERVICES_FILE } : {}),
      config: {
        ...((base.android as { config?: Record<string, unknown> } | undefined)?.config ?? {}),
        ...((config.android as { config?: Record<string, unknown> } | undefined)?.config ?? {}),
        ...(GOOGLE_MAPS_API_KEY
          ? { googleMaps: { apiKey: GOOGLE_MAPS_API_KEY } }
          : {}),
      },
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
      "expo-localization",
      [
        "expo-build-properties",
        {
          android: {
            minSdkVersion: 26,
            compileSdkVersion: 35,
            targetSdkVersion: 35,
            // Базовый soft-input. На Android 15 + edge-to-edge `adjustResize` часто
            // не сжимает окно — WizardShell дополнительно поднимает контент через
            // paddingBottom = высота IME (см. modules/onboarding/wizard/WizardShell.tsx).
            windowSoftInputMode: "adjustResize",
          },
        },
      ],
      [
        "@sfourdrinier/react-native-ble-plx",
        {
          // Scan itself is not used for location (BLUETOOTH_SCAN neverForLocation).
          // Do NOT rely on BLE's capped ACCESS_*_LOCATION (maxSdkVersion=30) —
          // expo-location needs GPS on all SDKs; conflicting maxSdkVersion fails Play.
          neverForLocation: true,
          bluetoothAlwaysPermission:
            "Harmonizer использует Bluetooth для подключения совместимых нагрудных пульсометров и получения точных ударов R-R.",
        },
      ],
      // After BLE plugin: collapse location permissions for Google Play merge rules.
      "./plugins/with-android-location-permission-merge.js",
      "react-native-health-connect",
      "./plugins/with-native-health.js",
    ],
  };
};
