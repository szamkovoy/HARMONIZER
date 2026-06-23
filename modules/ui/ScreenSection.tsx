import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { AppText } from "@/modules/ui/AppText";

export function SectionHeader({
  title,
  subtitle,
  style,
  center = false,
}: {
  title: string;
  subtitle?: string | null;
  style?: StyleProp<ViewStyle>;
  center?: boolean;
}) {
  return (
    <View style={[styles.header, style]}>
      <AppText variant="sectionTitle" style={center ? styles.centerText : null}>
        {title}
      </AppText>
      {subtitle ? (
        <AppText variant="screenHint" tone="muted" style={center ? styles.centerText : null}>
          {subtitle}
        </AppText>
      ) : null}
    </View>
  );
}

export function ScreenSection({
  title,
  subtitle,
  children,
  style,
  headerStyle,
  footer,
  centerHeader = false,
}: {
  title: string;
  subtitle?: string | null;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  headerStyle?: StyleProp<ViewStyle>;
  footer?: ReactNode;
  centerHeader?: boolean;
}) {
  return (
    <View style={[styles.section, style]}>
      <SectionHeader title={title} subtitle={subtitle} style={headerStyle} center={centerHeader} />
      {children}
      {footer}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 12,
  },
  header: {
    gap: 6,
  },
  centerText: {
    textAlign: "center",
  },
});
