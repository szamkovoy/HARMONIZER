import { forwardRef, type ReactNode } from "react";
import { ScrollView, StyleSheet, type ScrollViewProps, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { useTabContentBottomPadding } from "@/modules/ui/useTabContentBottomPadding";
import { useTheme } from "@/modules/ui/theme";

type TabScreenContentOptions = {
  horizontalPadding?: number;
  topPadding?: number;
  bottomPaddingExtra?: number;
  gap?: number;
  maxWidth?: number;
};

export function useTabScreenContentProps(options?: TabScreenContentOptions) {
  const horizontalPadding = options?.horizontalPadding ?? 20;
  const topPadding = options?.topPadding ?? 20;
  const bottomPaddingExtra = options?.bottomPaddingExtra ?? 24;
  const gap = options?.gap ?? 18;
  const maxWidth = options?.maxWidth;
  const contentBottomPadding = useTabContentBottomPadding(bottomPaddingExtra);

  return {
    contentBottomPadding,
    scrollIndicatorInsets: { bottom: contentBottomPadding },
    contentContainerStyle: [
      styles.content,
      {
        paddingTop: topPadding,
        paddingBottom: contentBottomPadding,
        paddingHorizontal: horizontalPadding,
        gap,
      },
      maxWidth ? { alignSelf: "center", maxWidth } : null,
    ] as StyleProp<ViewStyle>,
  };
}

export const TabScrollView = forwardRef<ScrollView, ScrollViewProps & {
  children: ReactNode;
  contentOptions?: TabScreenContentOptions;
}>(function TabScrollView({
  children,
  contentOptions,
  contentContainerStyle,
  scrollIndicatorInsets,
  ...props
}, ref) {
  const shared = useTabScreenContentProps(contentOptions);
  return (
    <ScrollView
      ref={ref}
      {...props}
      contentContainerStyle={[shared.contentContainerStyle, contentContainerStyle]}
      scrollIndicatorInsets={{
        ...shared.scrollIndicatorInsets,
        ...scrollIndicatorInsets,
      }}
    >
      {children}
    </ScrollView>
  );
});

const TAB_SCREEN_SAFE_AREA_EDGES: Edge[] = ["top", "left", "right"];

export function TabScreenLayout({
  children,
  style,
  statusBarStyle,
  edges = TAB_SCREEN_SAFE_AREA_EDGES,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  statusBarStyle?: "light" | "dark" | "auto";
  edges?: Edge[];
}) {
  const theme = useTheme();
  const resolvedStatusBarStyle = statusBarStyle ?? (theme.scheme === "dark" ? "light" : "dark");

  return (
    <SafeAreaView edges={edges} style={[styles.safeArea, { backgroundColor: theme.colors.screenBg }, style]}>
      <StatusBar style={resolvedStatusBarStyle} />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  content: {
    width: "100%",
  },
});
