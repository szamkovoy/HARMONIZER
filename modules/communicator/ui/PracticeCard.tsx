import { Pressable, StyleSheet, View } from "react-native";

import type { CommunicatorStrings } from "@/modules/communicator/i18n/communicator";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import type { PracticePicked } from "@/services/communicator-client";

export function PracticeCard({
  practice,
  strings,
  onPress,
}: {
  practice: PracticePicked;
  strings: CommunicatorStrings;
  onPress?: (practice: PracticePicked) => void;
}) {
  const theme = useTheme();
  const title = practice.name ?? strings.practiceCard.fallbackTitle;

  return (
    <View style={styles.row}>
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.surfaceElevated,
            borderColor: theme.colors.accent,
          },
        ]}
      >
        <AppText variant="technicalCaption" tone="accent" style={styles.eyebrow}>
          {strings.practiceCard.eyebrow}
        </AppText>
        <AppText variant="sectionTitle">{title}</AppText>
        {practice.reason ? (
          <AppText variant="dialogBody" tone="muted">{practice.reason}</AppText>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.practiceCard.startAccessibilityLabel}
          onPress={() => onPress?.(practice)}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: theme.colors.buttonPrimaryBg,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <AppText variant="buttonLabel" tone="accentOn">
            {strings.practiceCard.startButton}
          </AppText>
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
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  button: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginTop: 2,
  },
});
