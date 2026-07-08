import { Linking, Text } from "react-native";

import { splitBodyIntoSegments } from "@/modules/posts/core/linkify";
import { AppText } from "@/modules/ui/AppText";

/** Подпись сторис: URL кликабельны, открываются через системный Linking (браузер / YouTube и т.д.). */
export function StoryCaption({ text }: { text: string }) {
  const segments = splitBodyIntoSegments(text);
  return (
    <AppText variant="dialogBody" style={styles.captionText}>
      {segments.map((segment, index) =>
        segment.type === "link" ? (
          <Text
            key={index}
            accessibilityRole="link"
            style={styles.link}
            onPress={() => void Linking.openURL(segment.value)}
          >
            {segment.value}
          </Text>
        ) : (
          <Text key={index} style={styles.captionText}>
            {segment.value}
          </Text>
        ),
      )}
    </AppText>
  );
}

const styles = {
  captionText: {
    color: "#fff",
  },
  link: {
    color: "#B8E0FF",
    textDecorationLine: "underline" as const,
  },
};
