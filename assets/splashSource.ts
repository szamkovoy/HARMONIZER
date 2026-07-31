/**
 * Единый сплэш-ассет: нативный экран (expo-splash-screen plugin) и JS-оверлей
 * берут один и тот же файл `assets/images/splash.png`.
 *
 * iOS: `enableFullScreenImage_legacy: true`. Android 12+: системный splash —
 * только цвет фона (иконка скрыта плагином `with-android-splash-hide-icon`);
 * полный кадр даёт `EarlySplashCover` до загрузки шрифтов.
 * Смена PNG / опций плагина → native rebuild.
 */
import type { ImageSourcePropType } from "react-native";

const splashImage: ImageSourcePropType = require("./images/splash.png");

export default splashImage;
