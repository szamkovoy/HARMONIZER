import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import {
  closedLineCountWhileTyping,
  splitAssistantLines,
} from "@/modules/communicator/ui/assistantLineReveal";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

const LINE_FADE_MS = 280;
const LINE_PACE_MS = 170;
const REVEAL_SETTLE_MS = 80;

type Props = {
  /** Уже без LLM-маркеров (`stripStreamingMarkers`). */
  stripTarget: string;
  isStreamingTyping: boolean;
  /** После `complete`: stripped финал; до этого `null`. */
  revealGoal: string | null;
  onRevealComplete?: () => void;
};

/**
 * Стрим-ответ: спиннер до первой закрытой строки / финала, затем построчный FadeIn
 * (без побуквенного хвоста). После `revealGoal` — paced reveal оставшихся строк.
 */
export function StreamingAssistantLines({
  stripTarget,
  isStreamingTyping,
  revealGoal,
  onRevealComplete,
}: Props) {
  const theme = useTheme();
  const doneRef = useRef(false);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cbRef = useRef(onRevealComplete);
  cbRef.current = onRevealComplete;

  const sourceText = revealGoal ?? stripTarget;
  const lines = useMemo(() => splitAssistantLines(sourceText), [sourceText]);
  const [visibleCount, setVisibleCount] = useState(0);

  const pacing = revealGoal != null || (!isStreamingTyping && lines.length > 0);

  useEffect(() => {
    if (stripTarget.length === 0 && revealGoal == null) {
      doneRef.current = false;
      setVisibleCount(0);
    }
  }, [stripTarget, revealGoal]);

  useEffect(() => {
    if (!revealGoal) doneRef.current = false;
  }, [revealGoal]);

  // While typing without a goal: only show lines closed by `\n`.
  useEffect(() => {
    if (pacing) return;
    const closed = closedLineCountWhileTyping(stripTarget);
    setVisibleCount((prev) => Math.max(prev, closed));
  }, [pacing, stripTarget]);

  // After complete (or typing finished): reveal one more line on a timer.
  useEffect(() => {
    if (!pacing) return;
    const target = lines.length;
    if (target === 0 || visibleCount >= target) return;
    const delay = visibleCount === 0 ? 0 : LINE_PACE_MS;
    const timer = setTimeout(() => {
      setVisibleCount((prev) => Math.min(prev + 1, target));
    }, delay);
    return () => clearTimeout(timer);
  }, [pacing, lines.length, visibleCount]);

  // Notify when all lines of the reveal goal are visible.
  useEffect(() => {
    if (!revealGoal || !cbRef.current) return;
    if (sourceText !== revealGoal) return;
    if (doneRef.current) return;
    if (lines.length > 0 && visibleCount < lines.length) return;
    doneRef.current = true;
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(() => {
      settleTimerRef.current = null;
      cbRef.current?.();
    }, REVEAL_SETTLE_MS);
    return () => {
      if (settleTimerRef.current) {
        clearTimeout(settleTimerRef.current);
        settleTimerRef.current = null;
      }
    };
  }, [revealGoal, sourceText, visibleCount, lines.length]);

  const shown = lines.slice(0, visibleCount);
  const thinking = shown.length === 0;

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
          shown.map((line, i) => (
            <Animated.View key={`ln-${i}`} entering={FadeIn.duration(LINE_FADE_MS)}>
              <AppText variant="screenHint" style={styles.line}>
                {line.length > 0 ? line : "\u00a0"}
              </AppText>
            </Animated.View>
          ))
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
