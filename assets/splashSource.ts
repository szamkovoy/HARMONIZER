/**
 * JS splash overlay asset (EarlySplashCover / AppStartupSplashOverlay).
 *
 * Native splash (expo-splash-screen plugin / Android windowBackground) still
 * uses `assets/images/splash.png` via app.json — do not change that without a
 * native rebuild.
 *
 * JS uses a smaller JPEG (`splash-js.jpg`) so Dev Client after `expo start -c`
 * can paint the logo immediately. A 2.4MB PNG over Metro often stayed blank
 * while TEMP SplashAppNamePreview already showed the app name.
 */
import type { ImageSourcePropType } from "react-native";

const splashImage: ImageSourcePropType = require("./images/splash-js.jpg");

export default splashImage;
