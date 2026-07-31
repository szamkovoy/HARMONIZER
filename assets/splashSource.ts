/**
 * Единый сплэш-ассет: нативный экран (expo-splash-screen plugin) и JS-оверлей
 * берут один и тот же файл `assets/images/splash.png`.
 *
 * iOS: `enableFullScreenImage_legacy: true` (full-bleed native).
 * Android 12+: centered icon ≤288dp + matching backgroundColor — JS
 * `EarlySplashCover` / `AppStartupSplashOverlay` supply the full-bleed frame.
 * Do not replace the native icon with a transparent drawable (blank white hang).
 * Смена PNG / опций плагина → native rebuild.
 */
import type { ImageSourcePropType } from "react-native";

const splashImage: ImageSourcePropType = require("./images/splash.png");

export default splashImage;
