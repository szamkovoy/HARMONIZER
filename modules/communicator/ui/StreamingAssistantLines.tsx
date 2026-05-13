import { useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

function splitLines(text: string): { completed: string[]; partial: string } {
  if (!text) return { completed: [], partial: "" };
  const parts = text.split("\n");
  if (parts.length === 1) return { completed: [], partial: parts[0] ?? "" };
  const partial = parts[parts.length - 1] ?? "";
  const completed = parts.slice(0, -1);
  return { completed, partial };
}

type Props = {
  /** Уже без LLM-маркеров (`stripStreamingMarkers`). */
  stripTarget: string;
  isStreamingTyping: boolean;
  /** После `complete`: stripped финал; до этого `null`. */
  revealGoal: string | null;
  onRevealComplete?: () => void;
};

/**
 * Стрим-ответ: спиннер до первого символа, затем строки с лёгким fade-in при появлении новой строки.
 */
export function StreamingAssistantLines({
  stripTarget,
  isStreamingTyping,
  revealGoal,
  onRevealComplete,
}: Props) {
  const theme = useTheme();
  const doneRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cbRef = useRef(onRevealComplete);
  cbRef.current = onRevealComplete;

  const { completed, partial } = useMemo(() => splitLines(stripTarget), [stripTarget]);
  const thinking = stripTarget.length === 0;

  useEffect(() => {
    if (stripTarget.length === 0) {
      doneRef.current = false;
    }
  }, [stripTarget]);

  useEffect(() => {
    if (!revealGoal || !cbRef.current) return;
    if (stripTarget !== revealGoal) return;
    if (doneRef.current) return;
    doneRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      cbRef.current?.();
    }, 300);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [revealGoal, stripTarget]);

  useEffect(() => {
    if (!revealGoal) doneRef.current = false;
  }, [revealGoal]);

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
        {thinking ? (
          <ActivityIndicator size="small" color={theme.colors.textMuted} />
        ) : (
          <>
            {completed.map((line, i) => (
              <Animated.View key={`ln-${i}`} entering={FadeIn.duration(280)}>
                <AppText variant="screenHint" style={styles.line}>
                  {line.length > 0 ? line : "\u00a0"}
                </AppText>
              </Animated.View>
            ))}
            <AppText variant="screenHint" style={styles.line}>
              {partial}
              {isStreamingTyping && partial.length > 0 ? (
                <AppText variant="screenHint" tone="faint">
                  ▍
                </AppText>
              ) : null}
            </AppText>
          </>
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
    alignItems: "flex-start",
  },
  bubble: {
    maxWidth: "92%",
    borderRadius: 20,
    borderBottomLeftRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 44,
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  line: {
    marginBottom: 2,
  },
});
