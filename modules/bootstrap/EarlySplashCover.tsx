/**
 * Full-bleed splash shown before fonts / providers mount.
 * Hides the native SplashScreen (often a tiny centered logo on Android 12+)
 * as soon as this cover paints — so the user sees the large art immediately.
 */
import { useCallback, useRef } from "react";
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

  return (
    <View style={[styles.root, { width, height }]} onLayout={notify}>
      <Image source={splashImage} style={{ width, height }} resizeMode="cover" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
});
