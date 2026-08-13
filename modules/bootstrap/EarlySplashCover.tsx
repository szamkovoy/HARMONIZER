/**
 * Full-bleed splash before fonts / across provider handoff.
 * Explicit window size — absoluteFill + cover can mis-scale on Fabric.
 *
 * iOS: native full-bleed via `enableFullScreenImage_legacy` + this cover;
 * light veil matches the softer AppStartup frame.
 *
 * Android 12+: system API cannot do full-bleed (only a centered icon). Plugin
 * `with-android-splash-hide-icon` uses transparent icon + full-bleed
 * `windowBackground` and hides the system splash from MainActivity.onCreate
 * so the large art is already up before JS. This cover matches that art for
 * the handoff into `AppStartupSplashOverlay`.
 */
import { useCallback, useEffect, useRef } from "react";
import { Image, Platform, StyleSheet, useWindowDimensions, View } from "react-native";

import splashImage from "@/assets/splashSource";

/** Last-resort only — bundled assets should hit onLoadEnd well before this. */
const NATIVE_HIDE_SAFETY_MS = 3_000;

export function EarlySplashCover({ onPainted }: { onPainted: () => void }) {
  const { width, height } = useWindowDimensions();
  const once = useRef(false);
  const notify = useCallback(() => {
    if (once.current) return;
    once.current = true;
    onPainted();
  }, [onPainted]);

  // Wait for JS image paint before dismissing native splash (both platforms).
  // Instant Android notify left a white frame when Metro was still serving the asset.
  useEffect(() => {
    const t = setTimeout(notify, NATIVE_HIDE_SAFETY_MS);
    return () => clearTimeout(t);
  }, [notify]);

  return (
    <View style={[styles.root, { width, height }]}>
      <Image
        source={splashImage}
        style={{ width, height }}
        resizeMode="cover"
        fadeDuration={0}
        onLoad={notify}
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
