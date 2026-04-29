import { Pressable, StyleSheet, View } from "react-native";

import type { CommunicatorStrings } from "@/modules/communicator/i18n/communicator";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

export function ScrollDownHint({
  visible,
  onPress,
  strings,
}: {
  visible: boolean;
  onPress: () => void;
  strings: CommunicatorStrings;
}) {
  const theme = useTheme();

  if (!visible) return null;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={strings.scrollDownAccessibilityLabel}
        onPress={onPress}
        style={[
          styles.btn,
          {
            backgroundColor: theme.colors.surfaceElevated,
            borderColor: theme.colors.surfaceBorder,
          },
        ]}
      >
        <AppText variant="sectionTitle">↓</AppText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    bottom: 100,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 10,
  },
  btn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
});
