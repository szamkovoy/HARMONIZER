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
 *   3. Firebase client configs (FCM + App Check):
 *      - Android `googleServicesFile`: локально `./google-services.json` (gitignore),
 *        на EAS — file-env `GOOGLE_SERVICES_JSON`.
 *      - iOS `googleServicesFile`: локально `./GoogleService-Info.plist` (gitignore),
 *        на EAS — file-env `GOOGLE_SERVICES_PLIST`.
 *      Плагины `@react-native-firebase/*` подключаются только когда для текущей
 *      платформы есть соответствующий файл — иначе prebuild падает
 *      (`Path to GoogleService-Info.plist is not defined`).
 *      iOS autolinking gated the same way in `react-native.config.js` (иначе
 *      pod install всё равно тянет RNFBAppCheck → AppCheckCore).
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
    "[app.config] google-services.json missing — Android remote push / App Check will stay off until the file is present locally or as EAS env GOOGLE_SERVICES_JSON.",
  );
}

/** iOS Firebase plist — required by `@react-native-firebase/app` during iOS prebuild. */
const GOOGLE_SERVICES_PLIST =
  (process.env.GOOGLE_SERVICES_PLIST || "").trim() ||
  (fs.existsSync(path.join(__dirname, "GoogleService-Info.plist"))
    ? "./GoogleService-Info.plist"
    : "");
if (!GOOGLE_SERVICES_PLIST) {
  console.warn(
    "[app.config] GoogleService-Info.plist missing — iOS App Check stays off until the file is present locally or as EAS env GOOGLE_SERVICES_PLIST.",
  );
}

/**
 * RNFirebase config plugins hard-fail if the platform file is absent.
 * Gate on `EAS_BUILD_PLATFORM` so an iOS build without the plist can still ship
 * (OTP App Check enforce is currently off — see DEPLOY.md).
 */
const EAS_PLATFORM = (process.env.EAS_BUILD_PLATFORM || "").trim();
const INCLUDE_FIREBASE_PLUGINS =
  EAS_PLATFORM === "ios"
    ? Boolean(GOOGLE_SERVICES_PLIST)
    : EAS_PLATFORM === "android"
      ? Boolean(GOOGLE_SERVICES_FILE)
      : Boolean(GOOGLE_SERVICES_FILE && GOOGLE_SERVICES_PLIST);
if (!INCLUDE_FIREBASE_PLUGINS) {
  console.warn(
    `[app.config] Skipping @react-native-firebase plugins (platform=${EAS_PLATFORM || "local"}).`,
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
const { buildLocales, LANGS } = require("./plugins/appLocalesData");

/**
 * App variants so Dev / Test / Store can sit side-by-side on one phone.
 * Set via eas.json `env.APP_VARIANT` (or locally for prebuild).
 * - development → "Harmonizer Expo" + *.dev ids (QR / Metro)
 * - preview → "Harmonizer Test" + *.preview ids (internal APK / ad-hoc)
 * - production → store ids (Play / App Store / TestFlight) — TestFlight
 *   always shares the production id (Apple rule); it replaces store, not Expo.
 */
type AppVariant = "development" | "preview" | "production";

function resolveAppVariant(): AppVariant {
  const raw = (process.env.APP_VARIANT || "production").trim().toLowerCase();
  if (raw === "development" || raw === "preview" || raw === "production") return raw;
  return "production";
}

function variantIdentity(variant: AppVariant): {
  name: string;
  displayNameSuffix: string;
  scheme: string;
  iosBundleId: string;
  androidPackage: string;
} {
  if (variant === "development") {
    return {
      name: "Harmonizer Expo",
      displayNameSuffix: " Expo",
      scheme: "com.zamkovoi.harmonizer.dev",
      iosBundleId: "com.zamkovoi.harmonizer.dev",
      androidPackage: "com.zamkovoi.harmonizer.dev",
    };
  }
  if (variant === "preview") {
    return {
      name: "Harmonizer Test",
      displayNameSuffix: " Test",
      scheme: "com.zamkovoi.harmonizer.preview",
      iosBundleId: "com.zamkovoi.harmonizer.preview",
      androidPackage: "com.zamkovoi.harmonizer.preview",
    };
  }
  return {
    name: "Harmonizer",
    displayNameSuffix: "",
    scheme: "com.zamkovoi.harmonizer.app",
    iosBundleId: "com.zamkovoi.harmonizer.app",
    androidPackage: "com.zamkovoi.harmonizer",
  };
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = appJson.expo as ExpoConfig;
  const variant = resolveAppVariant();
  const identity = variantIdentity(variant);
  const locales = buildLocales(identity.displayNameSuffix);

  return {
    ...base,
    ...config,
    name: identity.name,
    scheme: identity.scheme,
    locales,
    extra: {
      ...(base.extra as Record<string, unknown> | undefined),
      ...(config.extra as Record<string, unknown> | undefined),
      appVariant: variant,
    },
    ios: {
      ...base.ios,
      ...config.ios,
      bundleIdentifier: identity.iosBundleId,
      infoPlist: {
        ...(base.ios?.infoPlist ?? {}),
        ...(config.ios?.infoPlist ?? {}),
        CFBundleLocalizations: LANGS,
        // iOS 14+: without these keys there is no Settings → Local Network toggle,
        // and Harmonizer Expo cannot reach Metro on LAN (Android still works).
        NSLocalNetworkUsageDescription:
          "Harmonizer Expo подключается к компьютеру разработчика в локальной сети, чтобы загружать приложение во время разработки.",
        NSBonjourServices: ["_expo._tcp", "_http._tcp"],
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
      ...(GOOGLE_SERVICES_PLIST ? { googleServicesFile: GOOGLE_SERVICES_PLIST } : {}),
    },
    android: {
      ...base.android,
      ...config.android,
      package: identity.androidPackage,
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
      ...(INCLUDE_FIREBASE_PLUGINS
        ? (["@react-native-firebase/app", "@react-native-firebase/app-check"] as const)
        : []),
      // Stale CocoaPods CDN shard can omit AppCheckCore 11.3.x → Install pods exit 31.
      ...(INCLUDE_FIREBASE_PLUGINS
        ? (["./plugins/with-ios-appcheckcore-cdn-refresh.js"] as const)
        : []),
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
          ios: {
            useFrameworks: "static",
            ...(INCLUDE_FIREBASE_PLUGINS
              ? { forceStaticLinking: ["RNFBApp", "RNFBAppCheck"] }
              : {}),
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
      // After expo-splash-screen (in app.json): hide Android 12+ centered icon.
      // Must pair with EarlySplashCover hide-only-after Image.onLoadEnd.
      "./plugins/with-android-splash-hide-icon.js",
    ],
  };
};
