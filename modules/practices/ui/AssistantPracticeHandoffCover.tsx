import { ActivityIndicator, StyleSheet, View } from "react-native";

import { useTheme } from "@/modules/ui/theme";

/** Opaque full-screen cover while assistant Modal waits for practice route paint. */
export function AssistantPracticeHandoffCover() {
  const theme = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: theme.colors.screenBg }]}>
      <ActivityIndicator color={theme.colors.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
