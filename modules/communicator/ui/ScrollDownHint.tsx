import { Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";

export function ScrollDownHint({
  visible,
  onPress,
}: {
  visible: boolean;
  onPress: () => void;
}) {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";

  if (!visible) return null;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Прокрутить вниз"
        onPress={onPress}
        style={[
          styles.btn,
          {
            backgroundColor: isDark ? "rgba(23,23,23,0.96)" : "rgba(255,255,255,0.96)",
            borderColor: isDark ? "#525252" : "#e5e5e5",
          },
        ]}
      >
        <Text style={[styles.arrow, { color: isDark ? "#e5e5e5" : "#404040" }]}>
          ↓
        </Text>
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
  arrow: {
    fontSize: 18,
    fontWeight: "600",
  },
});
