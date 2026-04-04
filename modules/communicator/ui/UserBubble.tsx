import { useEffect, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";

const COLLAPSE_LEN = 220;

export function UserBubble({
  text,
  isStreaming,
}: {
  text: string;
  isStreaming: boolean;
}) {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const [expanded, setExpanded] = useState(false);
  const long = text.length > COLLAPSE_LEN;
  const showToggle = long && !isStreaming;
  const display =
    !showToggle || expanded ? text : `${text.slice(0, COLLAPSE_LEN)}…`;

  useEffect(() => {
    if (!long) setExpanded(false);
  }, [text, long]);

  return (
    <View style={styles.row}>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: isDark ? "#262626" : "#f5f5f5",
          },
        ]}
      >
        <Text
          style={[styles.text, { color: isDark ? "#fafafa" : "#171717" }]}
        >
          {display || "\u00a0"}
        </Text>
        {showToggle && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={expanded ? "Свернуть" : "Развернуть"}
            onPress={() => setExpanded((e) => !e)}
            style={styles.toggle}
          >
            <Text style={styles.toggleGlyph}>{expanded ? "⌃" : "⌄"}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    width: "100%",
    paddingHorizontal: 12,
    paddingTop: 8,
    alignItems: "flex-end",
  },
  bubble: {
    maxWidth: "92%",
    borderRadius: 20,
    borderBottomRightRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  text: {
    fontSize: 15,
    lineHeight: 22,
  },
  toggle: {
    position: "absolute",
    bottom: 4,
    right: 8,
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  toggleGlyph: {
    fontSize: 18,
    color: "#737373",
  },
});
