import { useCallback, useEffect, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import { buildDonutSegments, clipDonutSegmentsForProgress, type DonutSegmentInput } from "@/modules/charts/buildDonutSegments";
import { calcBalance, segmentsToWeights } from "@/modules/charts/calcBalance";
import {
  DONUT_CENTER,
  DONUT_INNER_RADIUS,
  DONUT_OUTER_RADIUS,
  DONUT_TRACK_GAP,
  DONUT_TRACK_WIDTH,
  DONUT_VIEW_SIZE,
} from "@/modules/charts/constants";
import { useDonutRevealSession } from "@/modules/charts/DonutVisibilityContext";
import { donutPath, easeOutCubic, strokeArcPath } from "@/modules/charts/donutGeometry";
import { getChartStrings } from "@/modules/charts/i18n/charts";
import { useDonutAnimation } from "@/modules/charts/useDonutAnimation";
import { useDonutVisibilityTrigger } from "@/modules/charts/useDonutVisibilityTrigger";
import type { AppContentLocale } from "@/modules/i18n/localeCodes";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

export type { DonutSegmentInput };

export type DonutRevealMode = "immediate" | "inViewport";

type DonutChartProps = {
  segments: readonly DonutSegmentInput[];
  locale?: AppContentLocale;
  animationKey?: string;
  revealMode?: DonutRevealMode;
};

const BALANCE_STROKE_OPACITY = 0.58;

function buildAnimationKey(segments: readonly DonutSegmentInput[]) {
  return segments.map((segment) => `${segment.id}:${segment.value}`).join("|");
}

export function DonutChart({
  segments,
  locale = "ru",
  animationKey,
  revealMode = "inViewport",
}: DonutChartProps) {
  const theme = useTheme();
  const strings = getChartStrings(locale);
  const { progress: renderProgress, progressRef, start: startAnimation, reset: resetAnimation } = useDonutAnimation();
  const revealSession = useDonutRevealSession();
  const resolvedAnimationKey = animationKey ?? buildAnimationKey(segments);
  const visibilityResetKey = `${revealSession}|${resolvedAnimationKey}`;

  const weights = useMemo(() => segmentsToWeights(segments), [segments]);
  const { balance, angle: balanceAngle } = useMemo(() => calcBalance(weights), [weights]);
  const { segments: builtSegments } = useMemo(() => buildDonutSegments(segments), [segments]);
  const hasData = builtSegments.length > 0;
  const chartEnabled = hasData || balance > 0;
  const useViewportReveal = revealMode === "inViewport";

  const handleReset = useCallback(() => {
    resetAnimation();
  }, [resetAnimation]);

  const handleVisible = useCallback(() => {
    startAnimation();
  }, [startAnimation]);

  const { containerRef, onLayout } = useDonutVisibilityTrigger({
    onVisible: handleVisible,
    enabled: chartEnabled && useViewportReveal,
    resetKey: visibilityResetKey,
    getProgress: () => progressRef.current,
    onReset: useViewportReveal ? handleReset : undefined,
  });

  useEffect(() => {
    if (!chartEnabled || useViewportReveal) return undefined;
    startAnimation();
    return undefined;
  }, [chartEnabled, startAnimation, useViewportReveal, visibilityResetKey]);

  const balancePhase = renderProgress < 0.6 ? 0 : easeOutCubic((renderProgress - 0.6) / 0.4);
  const textOpacity = renderProgress < 0.85 ? 0 : Math.min(1, (renderProgress - 0.85) / 0.15);
  const visibleSegments = useMemo(
    () => clipDonutSegmentsForProgress(builtSegments, renderProgress),
    [builtSegments, renderProgress],
  );
  const visibleBalanceAngle = balancePhase * balanceAngle;
  const trackRadius = DONUT_INNER_RADIUS - DONUT_TRACK_GAP;
  const balanceStroke = theme.colors.textMuted;
  const trackStroke = theme.scheme === "dark" ? "rgba(255,255,255,0.14)" : "rgba(15,23,42,0.12)";

  return (
    <View ref={containerRef} style={styles.root} onLayout={useViewportReveal ? onLayout : undefined} collapsable={false}>
      <View style={styles.chartColumn}>
        <View style={styles.chartBox}>
          <Svg width={DONUT_VIEW_SIZE} height={DONUT_VIEW_SIZE} viewBox={`0 0 ${DONUT_VIEW_SIZE} ${DONUT_VIEW_SIZE}`}>
            {visibleSegments.map((segment) => (
              <Path
                key={segment.id}
                d={donutPath(DONUT_CENTER, DONUT_CENTER, DONUT_OUTER_RADIUS, DONUT_INNER_RADIUS, segment.startAngle, segment.endAngle)}
                fill={segment.color}
              />
            ))}
            <Circle
              cx={DONUT_CENTER}
              cy={DONUT_CENTER}
              r={trackRadius}
              stroke={trackStroke}
              strokeWidth={DONUT_TRACK_WIDTH}
              fill="none"
            />
            {visibleBalanceAngle > 0 ? (
              <Path
                d={strokeArcPath(DONUT_CENTER, DONUT_CENTER, trackRadius, visibleBalanceAngle)}
                stroke={balanceStroke}
                strokeOpacity={BALANCE_STROKE_OPACITY}
                strokeWidth={DONUT_TRACK_WIDTH}
                strokeLinecap="round"
                fill="none"
              />
            ) : null}
          </Svg>
          <View style={styles.centerOverlay} pointerEvents="none">
            <AppText variant="sectionTitle" style={[styles.balanceValue, { opacity: textOpacity }]}>
              {balance}%
            </AppText>
            <AppText variant="technicalCaption" tone="muted" style={{ opacity: textOpacity }}>
              {strings.balanceLabel}
            </AppText>
          </View>
        </View>
      </View>
      <View style={styles.legendColumn}>
        {segments.map((segment) => {
          const isZero = segment.value <= 0;
          return (
            <View key={segment.id} style={styles.legendRow}>
              <View
                style={[
                  styles.legendSwatch,
                  {
                    backgroundColor: isZero ? theme.colors.surfaceBorder : segment.color,
                  },
                ]}
              />
              <AppText variant="technicalCaption" tone={isZero ? "faint" : "muted"} style={styles.legendLabel}>
                {segment.label}
                {segment.legendSuffix ? ` · ${segment.legendSuffix}` : ""}
              </AppText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  chartColumn: {
    alignItems: "center",
    justifyContent: "center",
  },
  chartBox: {
    height: DONUT_VIEW_SIZE,
    width: DONUT_VIEW_SIZE,
  },
  centerOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 0,
  },
  balanceValue: {
    fontSize: 22,
    lineHeight: 24,
    marginBottom: -3,
  },
  legendColumn: {
    flex: 1,
    gap: 8,
    justifyContent: "center",
  },
  legendRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  legendSwatch: {
    borderRadius: 999,
    height: 10,
    width: 10,
  },
  legendLabel: {
    flex: 1,
  },
});
