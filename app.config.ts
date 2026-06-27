/**
 * Динамический слой конфигурации Expo. Позволяет подставлять значения из
 * переменных окружения (EXPO_PUBLIC_*) во время prebuild — в чистом app.json
 * такого механизма нет.
 *
 * Expo читает app.config.ts (имеет приоритет) и мерджит с app.json. Здесь мы:
 *   1. Подтягиваем статическую часть из app.json.
 *   2. Добавляем плагин `expo-apple-authentication` (включает entitlement
 *      `com.apple.developer.applesignin` в сгенерированном проекте).
 *   3. Конфигурируем `@react-native-google-signin/google-signin` с
 *      `iosUrlScheme` — из EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME или автоматически
 *      из EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID (…apps.googleusercontent.com).
 *   4. Добавляем `NSLocationWhenInUseUsageDescription` — чтобы иметь право
 *      спрашивать геолокацию на онбординге (для эфемерид: восходы Солнца/Луны
 *      зависят от точных координат пользователя).
 *
 * Никаких секретных значений в сам файл не кладём — только имена env-переменных.
 */
import type { ExpoConfig, ConfigContext } from "expo/config";
import appJson from "./app.json";

const GOOGLE_IOS_URL_SCHEME_ENV = "EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME";
const GOOGLE_IOS_CLIENT_ID_ENV = "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID";

/** iOS OAuth client id …apps.googleusercontent.com → reversed URL scheme для Info.plist. */
function googleIosClientIdToReversedUrlScheme(iosClientId: string): string | null {
  const trimmed = iosClientId.trim();
  const suffix = ".apps.googleusercontent.com";
  if (!trimmed.endsWith(suffix)) return null;
  const part = trimmed.slice(0, -suffix.length);
  if (!part) return null;
  return `com.googleusercontent.apps.${part}`;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = appJson.expo as ExpoConfig;

  const fromEnv = process.env[GOOGLE_IOS_URL_SCHEME_ENV]?.trim();
  const fromIosClientId = googleIosClientIdToReversedUrlScheme(
    process.env[GOOGLE_IOS_CLIENT_ID_ENV] ?? "",
  );
  const googleIosUrlScheme = fromEnv || fromIosClientId;

  if (!googleIosUrlScheme) {
    // Не падаем: prebuild допустим и без Google (напр., для чистого биофидбэка),
    // но логируем, чтобы забытую переменную легко было заметить.
    // eslint-disable-next-line no-console
    console.warn(
      `[app.config] Set ${GOOGLE_IOS_CLIENT_ID_ENV} or ${GOOGLE_IOS_URL_SCHEME_ENV} — ` +
        `Google Sign-In will use a placeholder iosUrlScheme until prebuild sees one of them.`,
    );
  }

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
      "expo-apple-authentication",
      [
        "@react-native-google-signin/google-signin",
        {
          iosUrlScheme: googleIosUrlScheme ?? "com.googleusercontent.apps.PLACEHOLDER",
        },
      ],
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
