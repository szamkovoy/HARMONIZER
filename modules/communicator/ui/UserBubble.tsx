import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import type { CommunicatorStrings } from "@/modules/communicator/i18n/communicator";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

const COLLAPSE_LEN = 220;

export function UserBubble({
  text,
  isStreaming,
  voicePending,
  strings,
}: {
  text: string;
  isStreaming: boolean;
  /** Пузырь «идёт расшифровка» до появления текста — только индикатор */
  voicePending?: boolean;
  strings: CommunicatorStrings;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const long = text.length > COLLAPSE_LEN;
  const showToggle = long && !isStreaming;
  const display =
    !showToggle || expanded ? text : `${text.slice(0, COLLAPSE_LEN)}…`;

  useEffect(() => {
    if (!long) setExpanded(false);
  }, [text, long]);

  if (voicePending) {
    return (
      <View style={styles.row}>
        <View
          style={[
            styles.bubble,
            styles.pendingBubble,
            {
              backgroundColor: theme.colors.controlButtonBg,
            },
          ]}
          accessibilityRole="progressbar"
          accessibilityLabel={strings.voiceUserBubblePending}
        >
          <ActivityIndicator size="small" color={theme.colors.textMuted} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <View
        style={[
          styles.bubble,
          {
            backgroundColor: theme.colors.controlButtonBg,
          },
        ]}
      >
        <AppText variant="screenHint">
          {display || "\u00a0"}
        </AppText>
        {showToggle && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={expanded ? strings.collapseAccessibilityLabel : strings.expandAccessibilityLabel}
            onPress={() => setExpanded((e) => !e)}
            style={styles.toggle}
          >
            <AppText variant="sectionTitle" tone="faint">
              {expanded ? "⌃" : "⌄"}
            </AppText>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pendingBubble: {
    minWidth: 52,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
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
  toggle: {
    position: "absolute",
    bottom: 4,
    right: 8,
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
});
