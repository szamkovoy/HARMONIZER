import { forwardRef, type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView, useSafeAreaInsets, type Edge } from "react-native-safe-area-context";

import { SurfaceCardView } from "@/modules/ui/SurfaceCardView";
import { useTheme } from "@/modules/ui/theme";

type StackScreenContentOptions = {
  horizontalPadding?: number;
  topPadding?: number;
  bottomPaddingExtra?: number;
  gap?: number;
  maxWidth?: number;
};

export function useStackScreenContentProps(options?: StackScreenContentOptions) {
  const insets = useSafeAreaInsets();
  const horizontalPadding = options?.horizontalPadding ?? 20;
  const topPadding = options?.topPadding ?? 0;
  const bottomPaddingExtra = options?.bottomPaddingExtra ?? 24;
  const gap = options?.gap ?? 18;
  const maxWidth = options?.maxWidth;
  const contentBottomPadding = insets.bottom + bottomPaddingExtra;

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

export const StackScrollView = forwardRef<
  ScrollView,
  ScrollViewProps & {
    children: ReactNode;
    contentOptions?: StackScreenContentOptions;
  }
>(function StackScrollView(
  { children, contentOptions, contentContainerStyle, scrollIndicatorInsets, ...props },
  ref,
) {
  const shared = useStackScreenContentProps(contentOptions);

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

export function StackScreenLayout({
  children,
  style,
  statusBarStyle,
  edges,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  statusBarStyle?: "light" | "dark" | "auto";
  edges?: Edge[];
}) {
  const theme = useTheme();
  const resolvedStatusBarStyle = statusBarStyle ?? (theme.scheme === "dark" ? "light" : "dark");

  return (
    <SafeAreaView
      edges={edges}
      style={[styles.safeArea, { backgroundColor: theme.colors.screenBg }, style]}
    >
      <StatusBar style={resolvedStatusBarStyle} />
      {children}
    </SafeAreaView>
  );
}

export function ModalScreenLayout({
  children,
  overlay,
  style,
  keyboard = false,
  statusBarStyle = "light",
  edges,
  centered = true,
  horizontalPadding = 24,
  maxWidth = 420,
}: {
  children: ReactNode;
  overlay?: ReactNode;
  style?: StyleProp<ViewStyle>;
  keyboard?: boolean;
  statusBarStyle?: "light" | "dark" | "auto";
  edges?: Edge[];
  centered?: boolean;
  horizontalPadding?: number;
  maxWidth?: number;
}) {
  const body = (
    <View
      style={[
        styles.modalBody,
        {
          justifyContent: centered ? "center" : "flex-start",
          paddingHorizontal: horizontalPadding,
        },
        style,
      ]}
    >
      <View style={[styles.modalContent, { maxWidth }]}>{children}</View>
    </View>
  );

  return (
    <StackScreenLayout edges={edges} statusBarStyle={statusBarStyle}>
      {overlay}
      {keyboard ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.keyboard}
        >
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </StackScreenLayout>
  );
}

export function FormScreenLayout({
  children,
  cardStyle,
  style,
  keyboard = false,
  statusBarStyle = "light",
  edges,
  maxWidth = 420,
  centered = true,
}: {
  children: ReactNode;
  cardStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  keyboard?: boolean;
  statusBarStyle?: "light" | "dark" | "auto";
  edges?: Edge[];
  maxWidth?: number;
  centered?: boolean;
}) {
  return (
    <ModalScreenLayout
      keyboard={keyboard}
      statusBarStyle={statusBarStyle}
      edges={edges}
      maxWidth={maxWidth}
      centered={centered}
      style={style}
    >
      <SurfaceCardView tone="elevated" style={[styles.formCard, cardStyle]}>
        {children}
      </SurfaceCardView>
    </ModalScreenLayout>
  );
}

export function HeroScreenLayout({
  header,
  children,
  footer,
  style,
  statusBarStyle,
}: {
  header: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
  statusBarStyle?: "light" | "dark" | "auto";
}) {
  const insets = useSafeAreaInsets();

  return (
    <StackScreenLayout statusBarStyle={statusBarStyle}>
      <View
        style={[
          styles.hero,
          {
            paddingTop: insets.top + 24,
            paddingBottom: insets.bottom + 24,
          },
          style,
        ]}
      >
        <View style={styles.heroHeader}>{header}</View>
        <View style={styles.heroBody}>{children}</View>
        {footer ? <View>{footer}</View> : null}
      </View>
    </StackScreenLayout>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  keyboard: {
    flex: 1,
  },
  content: {
    width: "100%",
  },
  modalBody: {
    flex: 1,
    width: "100%",
  },
  modalContent: {
    alignSelf: "center",
    width: "100%",
  },
  formCard: {
    paddingTop: 22,
  },
  hero: {
    flex: 1,
    justifyContent: "space-between",
    paddingHorizontal: 24,
  },
  heroHeader: {
    alignItems: "center",
    marginTop: 48,
  },
  heroBody: {
    gap: 12,
  },
});
