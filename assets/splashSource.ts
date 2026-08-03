/**
 * Единый сплэш-ассет: нативный экран (expo-splash-screen plugin) и JS-оверлей
 * берут один и тот же файл `assets/images/splash.png`.
 *
 * iOS: `enableFullScreenImage_legacy: true` + `EarlySplashCover`.
 * Android 12+: `with-android-splash-hide-icon` — прозрачный system icon,
 * full-bleed `windowBackground` из того же PNG, `SplashScreenManager.hide()`
 * в MainActivity.onCreate (большая заставка без ожидания JS / без mini-icon).
 * Смена PNG / плагина → native rebuild / prebuild.
 */
import type { ImageSourcePropType } from "react-native";

const splashImage: ImageSourcePropType = require("./images/splash.png");

export default splashImage;
