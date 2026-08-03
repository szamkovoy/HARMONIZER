/**
 * TEMP QA PREVIEW — single localized app name on the JS splash (2026-08-03).
 * Not for shipping. One-shot fade only (no motion).
 * Label: `t(locale, "common.appName")` for the active app locale (RU/EN/…).
 *
 * Font: Verdana; if missing on the device, RN falls back to the default system
 * sans — `adjustsFontSizeToFit` still fits NAME_WIDTH_FRACTION of screen width.
 *
 * REVERT preview:
 * 1. Delete this file: `modules/bootstrap/SplashAppNamePreview.tsx`
 * 2. In `modules/bootstrap/AppStartupProvider.tsx` remove import + `<SplashAppNamePreview />`
 */
import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { t, type AppLocale } from "@/modules/i18n";

/** Flip to false to hide the name without deleting the file. */
export const TEMP_SPLASH_APP_NAME_PREVIEW = true;

/** Title fits this fraction of screen width. */
const NAME_WIDTH_FRACTION = 0.42;

export function SplashAppNamePreview({ locale }: { locale: AppLocale }) {
  const { width: winW } = useWindowDimensions();
  const label = useMemo(() => t(locale, "common.appName").toLocaleUpperCase(locale), [locale]);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.timing(opacity, {
      toValue: 1,
      duration: 900,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    anim.start();
    return () => {
      anim.stop();
      opacity.stopAnimation();
    };
  }, [opacity]);

  if (!TEMP_SPLASH_APP_NAME_PREVIEW) return null;

  const rowWidth = winW * NAME_WIDTH_FRACTION;
  const left = (winW - rowWidth) / 2;

  return (
    <View pointerEvents="none" style={styles.layer}>
      <Animated.View
        style={[
          styles.row,
          {
            left,
            width: rowWidth,
            bottom: "32%",
            opacity,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.18}
          style={styles.name}
        >
          {label}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 3,
  },
  row: {
    position: "absolute",
    height: 48,
    justifyContent: "center",
  },
  name: {
    width: "100%",
    textAlign: "center",
    fontSize: 64,
    lineHeight: 48,
    fontFamily: "Verdana",
    fontWeight: "700",
    color: "#555555",
    letterSpacing: 0.5,
    includeFontPadding: false,
  },
});
