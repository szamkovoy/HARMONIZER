import { Linking, Text } from "react-native";

import { splitBodyIntoSegments } from "@/modules/posts/core/linkify";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

/** Plain-text тело публикации: переносы строк сохраняются, URL кликабельны. */
export function LinkifiedBody({ body }: { body: string }) {
  const theme = useTheme();
  const segments = splitBodyIntoSegments(body);
  return (
    <AppText variant="screenHint">
      {segments.map((segment, index) =>
        segment.type === "link" ? (
          <Text
            key={index}
            accessibilityRole="link"
            style={{ color: theme.colors.accent, textDecorationLine: "underline" }}
            onPress={() => void Linking.openURL(segment.value)}
          >
            {segment.value}
          </Text>
        ) : (
          <Text key={index}>{segment.value}</Text>
        ),
      )}
    </AppText>
  );
}
