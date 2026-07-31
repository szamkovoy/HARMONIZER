/**
 * Full-bleed splash shown before fonts / providers mount.
 * Hides the native SplashScreen once the cover image is ready — so Android 12+
 * (solid color, no icon; see `with-android-splash-hide-icon`) hands off to the
 * large art without a small→large jump.
 */
import { useCallback, useEffect, useRef } from "react";
import { Image, StyleSheet, useWindowDimensions, View } from "react-native";

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
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
});
