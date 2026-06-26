import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Dimensions, Easing, StyleSheet } from "react-native";

import { useTheme } from "@/modules/ui/theme";

const SCREEN_HEIGHT = Dimensions.get("window").height;
const SLIDE_MS = 320;

interface SlideUpModalLayerProps {
  children: ReactNode;
  zIndex?: number;
}

/** Full-screen layer that slides up from the bottom; parent stays static underneath. */
export function SlideUpModalLayer({ children, zIndex = 100 }: SlideUpModalLayerProps) {
  const theme = useTheme();
  const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;

  useEffect(() => {
    translateY.setValue(SCREEN_HEIGHT);
    Animated.timing(translateY, {
      toValue: 0,
      duration: SLIDE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [translateY]);

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFillObject,
        {
          zIndex,
          elevation: zIndex,
          backgroundColor: theme.colors.screenBg,
          transform: [{ translateY }],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
