/**
 * Full-bleed splash shown before fonts / providers mount.
 * Hides the native SplashScreen only after the cover image successfully loads —
 * so we never reveal a blank white frame under a failed/0-size decode.
 */
import { useCallback, useEffect, useRef } from "react";
import { Image, StyleSheet, View } from "react-native";

import splashImage from "@/assets/splashSource";

export function EarlySplashCover({ onPainted }: { onPainted: () => void }) {
  const once = useRef(false);
  const notify = useCallback(() => {
    if (once.current) return;
    once.current = true;
    onPainted();
  }, [onPainted]);

  // Last-resort: if onLoad never fires, still release native splash (branded icon
  // remains visible until then — do not use a short timeout that races decode).
  useEffect(() => {
    const t = setTimeout(notify, 2500);
    return () => clearTimeout(t);
  }, [notify]);

  return (
    <View style={styles.root}>
      <Image
        source={splashImage}
        style={styles.image}
        resizeMode="cover"
        fadeDuration={0}
        onLoad={notify}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#f7f7f7",
  },
  image: {
    ...StyleSheet.absoluteFillObject,
  },
});
