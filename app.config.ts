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
 *      `iosUrlScheme` — это «обратный» iOS Client ID из Google Cloud.
 *   4. Добавляем `NSLocationWhenInUseUsageDescription` — чтобы иметь право
 *      спрашивать геолокацию на онбординге (для эфемерид: восходы Солнца/Луны
 *      зависят от точных координат пользователя).
 *
 * Никаких секретных значений в сам файл не кладём — только имена env-переменных.
 */
import type { ExpoConfig, ConfigContext } from "expo/config";
import appJson from "./app.json";

const GOOGLE_IOS_URL_SCHEME_ENV = "EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME";

export default ({ config }: ConfigContext): ExpoConfig => {
  const base = appJson.expo as ExpoConfig;

  const googleIosUrlScheme = process.env[GOOGLE_IOS_URL_SCHEME_ENV];
  if (!googleIosUrlScheme) {
    // Не падаем: prebuild допустим и без Google (напр., для чистого биофидбэка),
    // но логируем, чтобы забытую переменную легко было заметить.
    // eslint-disable-next-line no-console
    console.warn(
      `[app.config] ${GOOGLE_IOS_URL_SCHEME_ENV} is not set — Google Sign-In ` +
        `will use a placeholder iosUrlScheme. Fill it in .env.local before ` +
        `running prebuild for a real iOS build.`,
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
        NSLocationWhenInUseUsageDescription:
          "Harmonizer использует геолокацию для точного расчёта астрономических окон возможностей — восходов/заходов Солнца, Луны и планет в вашем месте.",
      },
    },
    plugins: [
      ...(base.plugins ?? []),
      "expo-apple-authentication",
      [
        "@react-native-google-signin/google-signin",
        {
          iosUrlScheme:
            googleIosUrlScheme ?? "com.googleusercontent.apps.PLACEHOLDER",
        },
      ],
    ],
  };
};
