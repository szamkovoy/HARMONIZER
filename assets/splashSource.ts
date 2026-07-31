/**
 * Единый сплэш-ассет: нативный экран (expo-splash-screen plugin) и JS-оверлей
 * берут один и тот же файл `assets/images/splash.png`.
 *
 * iOS: `enableFullScreenImage_legacy: true` + `EarlySplashCover` (явные
 * `useWindowDimensions`, cover) до шрифтов.
 * Android 12+: native centered icon ≤288dp до `AppStartupSplashOverlay`
 * (без EarlySplashCover — иначе mini → растянутый кадр). Full-bleed JS с
 * явными width/height. Не подменять native icon прозрачным drawable.
 * Смена PNG / опций плагина → native rebuild.
 */
import type { ImageSourcePropType } from "react-native";

const splashImage: ImageSourcePropType = require("./images/splash.png");

export default splashImage;
