/**
 * Единый сплэш-ассет: нативный экран (expo.splash.image) и JS-оверлей берут
 * один и тот же файл `assets/images/splash.png`. Достаточно заменить этот PNG
 * и пересобрать нативный клиент (prebuild/EAS), чтобы обновить оба места.
 */
import type { ImageSourcePropType } from "react-native";

const splashImage: ImageSourcePropType = require("./images/splash.png");

export default splashImage;
