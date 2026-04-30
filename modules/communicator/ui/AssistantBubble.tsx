import { StyleSheet, View } from "react-native";

import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

export function AssistantBubble({
  text,
  isStreaming,
}: {
  text: string;
  isStreaming: boolean;
  phaseLabel?: string;
}) {
  const theme = useTheme();
  const display = text.trimStart();

  return (
    <View style={styles.row}>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: theme.colors.surfaceElevated,
            borderColor: theme.colors.surfaceBorder,
          },
        ]}
      >
        <AppText variant="screenHint">
          {display}
          {isStreaming ? (
            <AppText variant="screenHint" tone="faint">▍</AppText>
          ) : null}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    width: "100%",
    paddingHorizontal: 12,
    paddingTop: 8,
    alignItems: "flex-start",
  },
  bubble: {
    maxWidth: "92%",
    borderRadius: 20,
    borderBottomLeftRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
});
