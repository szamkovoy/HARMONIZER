/**
 * Full-bleed splash before fonts / across provider handoff.
 * Hides native SplashScreen after the cover image paints (or a long safety
 * timeout). Explicit window size — absoluteFill + cover can mis-scale on Fabric.
 *
 * iOS: a light veil matches the softer AppStartup frame (shimmer + chrome),
 * so the EarlySplashCover → AppStartup handoff does not flash brighter first.
 *
 * Android: native splash keeps a visible centered icon (hide-icon plugin is
 * disabled) so cold start never hangs on a blank white OS frame.
 */
import { useCallback, useEffect, useRef } from "react";
import { Image, Platform, StyleSheet, useWindowDimensions, View } from "react-native";

import splashImage from "@/assets/splashSource";

/** Last-resort only — bundled assets should hit onLoadEnd well before this. */
const NATIVE_HIDE_SAFETY_MS = 3_000;

export function EarlySplashCover({ onPainted }: { onPainted: () => void }) {
  const { width, height } = useWindowDimensions();
  const once = useRef(false);
  const imageReady = useRef(false);
  const notify = useCallback(() => {
    if (once.current) return;
    once.current = true;
    onPainted();
  }, [onPainted]);

  const onImageReady = useCallback(() => {
    imageReady.current = true;
    notify();
  }, [notify]);

  // Safety only: never race a short timeout ahead of the first painted frame.
  useEffect(() => {
    const t = setTimeout(() => {
      if (imageReady.current || once.current) return;
      notify();
    }, NATIVE_HIDE_SAFETY_MS);
    return () => clearTimeout(t);
  }, [notify]);

  return (
    <View style={[styles.root, { width, height }]}>
      <Image
        source={splashImage}
        style={{ width, height }}
        resizeMode="cover"
        fadeDuration={0}
        onLoad={onImageReady}
        onLoadEnd={onImageReady}
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
