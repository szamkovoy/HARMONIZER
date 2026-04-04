import { StyleSheet, Text, useColorScheme, View } from "react-native";

export function AssistantBubble({
  text,
  isStreaming,
}: {
  text: string;
  isStreaming: boolean;
}) {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const display = text.trimStart();

  return (
    <View style={styles.row}>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: isDark ? "#171717" : "#fff",
            borderColor: isDark ? "#404040" : "#e5e5e5",
          },
        ]}
      >
        <Text
          style={[styles.text, { color: isDark ? "#fafafa" : "#171717" }]}
        >
          {display}
          {isStreaming ? (
            <Text style={styles.cursor}>▍</Text>
          ) : null}
        </Text>
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
  text: {
    fontSize: 15,
    lineHeight: 22,
  },
  cursor: {
    opacity: 0.45,
    fontSize: 15,
  },
});
