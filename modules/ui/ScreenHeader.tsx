import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { AppText } from "@/modules/ui/AppText";

export function ScreenHeader({
  title,
  subtitle,
  style,
  centered = false,
  trailing,
}: {
  title: string;
  subtitle?: string | null;
  style?: StyleProp<ViewStyle>;
  centered?: boolean;
  /** Right-aligned control on the title row (e.g. help «?»). */
  trailing?: ReactNode;
}) {
  return (
    <View style={[styles.header, style]}>
      <View style={[styles.titleRow, centered ? styles.titleRowCentered : null]}>
        <AppText
          variant="screenTitle"
          accessibilityRole="header"
          style={[styles.title, centered ? styles.centerText : null]}
        >
          {title}
        </AppText>
        {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      </View>
      {subtitle ? (
        <AppText variant="screenHint" tone="muted" style={centered ? styles.centerText : null}>
          {subtitle}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: 8,
  },
  titleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  titleRowCentered: {
    justifyContent: "center",
  },
  title: {
    flex: 1,
    minWidth: 0,
  },
  trailing: {
    flexShrink: 0,
  },
  centerText: {
    textAlign: "center",
  },
});
