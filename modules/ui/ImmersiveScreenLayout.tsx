import type { ReactNode } from "react";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { useTheme } from "@/modules/ui/theme";

export function ImmersiveScreenLayout({
  children,
  style,
  statusBarStyle = "light",
  edges = [],
  backgroundColor,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  statusBarStyle?: "light" | "dark" | "auto";
  edges?: Edge[];
  backgroundColor?: string;
}) {
  const theme = useTheme();

  return (
    <SafeAreaView
      edges={edges}
      style={[
        styles.root,
        { backgroundColor: backgroundColor ?? theme.colors.screenBg },
        style,
      ]}
    >
      <StatusBar style={statusBarStyle} />
      {children}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
