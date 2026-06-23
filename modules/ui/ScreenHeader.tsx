import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { AppText } from "@/modules/ui/AppText";

export function ScreenHeader({
  title,
  subtitle,
  style,
  centered = false,
}: {
  title: string;
  subtitle?: string | null;
  style?: StyleProp<ViewStyle>;
  centered?: boolean;
}) {
  return (
    <View style={[styles.header, style]}>
      <AppText variant="screenTitle" accessibilityRole="header" style={centered ? styles.centerText : null}>
        {title}
      </AppText>
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
  centerText: {
    textAlign: "center",
  },
});
