import { Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";
import type { PracticePicked } from "@/services/communicator-client";

export function PracticeCard({
  practice,
  onPress,
}: {
  practice: PracticePicked;
  onPress?: (practice: PracticePicked) => void;
}) {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const title = practice.name ?? "Практика";

  return (
    <View style={styles.row}>
      <View
        style={[
          styles.card,
          {
            backgroundColor: isDark ? "#102018" : "#effdf6",
            borderColor: isDark ? "#24513d" : "#bbf7d0",
          },
        ]}
      >
        <Text style={[styles.eyebrow, { color: isDark ? "#86efac" : "#15803d" }]}>
          Подходящая практика
        </Text>
        <Text style={[styles.title, { color: isDark ? "#f0fdf4" : "#14532d" }]}>{title}</Text>
        {practice.reason ? (
          <Text style={[styles.reason, { color: isDark ? "#d1fae5" : "#166534" }]}>{practice.reason}</Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Начать практику"
          onPress={() => onPress?.(practice)}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Начать практику</Text>
        </Pressable>
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
  card: {
    maxWidth: "92%",
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  eyebrow: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  title: {
    fontSize: 16,
    fontWeight: "700",
  },
  reason: {
    fontSize: 14,
    lineHeight: 20,
  },
  button: {
    alignSelf: "flex-start",
    borderRadius: 999,
    backgroundColor: "#16a34a",
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginTop: 2,
  },
  buttonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
});
