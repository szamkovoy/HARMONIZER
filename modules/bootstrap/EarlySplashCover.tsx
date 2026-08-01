/**
 * Full-bleed splash before fonts / across provider handoff.
 * Hides native SplashScreen only after the cover image is ready — required on
 * Android 12+ when the system icon is transparent (`with-android-splash-hide-icon`).
 * Explicit window size — absoluteFill + cover can mis-scale on Fabric.
 *
 * iOS: a light veil matches the softer AppStartup frame (shimmer + chrome),
 * so the EarlySplashCover → AppStartup handoff does not flash brighter first.
 */
import { useCallback, useEffect, useRef } from "react";
import { Image, Platform, StyleSheet, useWindowDimensions, View } from "react-native";

import splashImage from "@/assets/splashSource";

export function EarlySplashCover({ onPainted }: { onPainted: () => void }) {
  const { width, height } = useWindowDimensions();
  const once = useRef(false);
  const notify = useCallback(() => {
    if (once.current) return;
    once.current = true;
    onPainted();
  }, [onPainted]);

  // Fallback if onLoadEnd never fires (should be rare for bundled assets).
  useEffect(() => {
    const t = setTimeout(notify, 400);
    return () => clearTimeout(t);
  }, [notify]);

  return (
    <View style={[styles.root, { width, height }]}>
      <Image
        source={splashImage}
        style={{ width, height }}
        resizeMode="cover"
        fadeDuration={0}
        onLoadEnd={notify}
      />
      {Platform.OS === "ios" ? (
        <View pointerEvents="none" style={[styles.iosMatchVeil, { width, height }]} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  /** Softens first JS frame (was brighter than AppStartup handoff). */
  iosMatchVeil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15, 23, 42, 0.08)",
  },
});
