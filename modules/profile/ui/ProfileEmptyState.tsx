import { StyleSheet, View } from "react-native";

import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

export function ProfileEmptyState(props: { message: string }) {
  const theme = useTheme();

  return (
    <View
      style={[
        styles.frame,
        {
          borderColor: theme.colors.surfaceBorder,
          backgroundColor: theme.colors.surfaceElevated,
        },
      ]}
    >
      <AppText variant="dialogBody" tone="muted" style={styles.message}>
        {props.message}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    minHeight: 120,
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  message: {
    textAlign: "center",
  },
});
