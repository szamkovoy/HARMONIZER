/**
 * Единый сплэш-ассет: нативный экран (expo-splash-screen plugin) и JS-оверлей
 * берут один и тот же файл `assets/images/splash.png`.
 *
 * iOS: `enableFullScreenImage_legacy: true` + `EarlySplashCover` (явные
 * `useWindowDimensions`, cover) до / через handoff к AppStartup.
 * Android 12+: видимая centered splash-icon (hide-icon plugin отключён —
 * прозрачный icon давал белый hang) + тот же EarlySplashCover.
 * Full-bleed JS с явными width/height (не absoluteFill).
 * Смена PNG / опций плагина → native rebuild / prebuild.
 */
import type { ImageSourcePropType } from "react-native";

const splashImage: ImageSourcePropType = require("./images/splash.png");

export default splashImage;
