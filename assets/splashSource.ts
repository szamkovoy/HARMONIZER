/**
 * Единый сплэш-ассет: нативный экран (expo-splash-screen plugin) и JS-оверлей
 * берут один и тот же файл `assets/images/splash.png`.
 *
 * iOS: `enableFullScreenImage_legacy: true` + `EarlySplashCover` (явные
 * `useWindowDimensions`, cover) до / через handoff к AppStartup.
 * Android 12+: `with-android-splash-hide-icon` (прозрачный system icon) +
 * тот же EarlySplashCover; hide native только после Image.onLoadEnd.
 * Full-bleed JS с явными width/height (не absoluteFill).
 * Смена PNG / опций плагина / hide-icon → native rebuild.
 */
import type { ImageSourcePropType } from "react-native";

const splashImage: ImageSourcePropType = require("./images/splash.png");

export default splashImage;
