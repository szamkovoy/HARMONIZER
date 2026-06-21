import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { buildDonutSegments, clipDonutSegmentsForProgress, type DonutSegmentInput } from "@/modules/charts/buildDonutSegments";
import { calcBalance, segmentsToWeights } from "@/modules/charts/calcBalance";
import {
  DONUT_ANIMATION_MS,
  DONUT_CENTER,
  DONUT_INNER_RADIUS,
  DONUT_OUTER_RADIUS,
  DONUT_TRACK_GAP,
  DONUT_TRACK_WIDTH,
  DONUT_VIEW_SIZE,
} from "@/modules/charts/constants";
import { useDonutVisibilityTrigger } from "@/modules/charts/useDonutVisibilityTrigger";
import { donutPath, easeOutCubic, strokeArcPath } from "@/modules/charts/donutGeometry";
import { getChartStrings } from "@/modules/charts/i18n/charts";
import type { AppContentLocale } from "@/modules/i18n/localeCodes";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

export type { DonutSegmentInput };

type DonutChartProps = {
  segments: readonly DonutSegmentInput[];
  locale?: AppContentLocale;
  animationKey?: string;
};

function buildAnimationKey(segments: readonly DonutSegmentInput[]) {
  return segments.map((segment) => `${segment.id}:${segment.value}:${segment.label}`).join("|");
}

export function DonutChart({ segments, locale = "ru", animationKey }: DonutChartProps) {
  const theme = useTheme();
  const strings = getChartStrings(locale);
  const progress = useSharedValue(0);
  const [renderProgress, setRenderProgress] = useState(0);
  const resolvedAnimationKey = animationKey ?? buildAnimationKey(segments);

  const weights = useMemo(() => segmentsToWeights(segments), [segments]);
  const { balance, angle: balanceAngle } = useMemo(() => calcBalance(weights), [weights]);
  const { segments: builtSegments } = useMemo(() => buildDonutSegments(segments), [segments]);
  const hasData = builtSegments.length > 0;

  const startAnimation = useCallback(() => {
    progress.value = 0;
    progress.value = withTiming(1, {
      duration: DONUT_ANIMATION_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [progress]);

  useAnimatedReaction(
    () => progress.value,
    (value) => {
      runOnJS(setRenderProgress)(value);
    },
  );

  const { containerRef, checkVisibility } = useDonutVisibilityTrigger(
    startAnimation,
    hasData || balance > 0,
    resolvedAnimationKey,
  );

  const donutProgress = easeOutCubic(renderProgress);
  const balanceProgress = renderProgress < 0.6 ? 0 : easeOutCubic((renderProgress - 0.6) / 0.4);
  const textOpacity = renderProgress < 0.85 ? 0 : Math.min(1, (renderProgress - 0.85) / 0.15);
  const visibleSegments = useMemo(
    () => clipDonutSegmentsForProgress(builtSegments, donutProgress),
    [builtSegments, donutProgress],
  );
  const visibleBalanceAngle = balanceProgress * balanceAngle;
  const trackRadius = DONUT_INNER_RADIUS - DONUT_TRACK_GAP;
  const balanceStroke = theme.scheme === "dark" ? "rgba(255,255,255,0.92)" : "rgba(15,23,42,0.88)";
  const trackStroke = theme.scheme === "dark" ? "rgba(255,255,255,0.14)" : "rgba(15,23,42,0.12)";

  return (
    <View ref={containerRef} style={styles.root} onLayout={checkVisibility}>
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
                strokeWidth={DONUT_TRACK_WIDTH}
                strokeLinecap="round"
                fill="none"
              />
            ) : null}
          </Svg>
          <View style={styles.centerOverlay} pointerEvents="none">
            <AppText variant="screenTitle" style={{ opacity: textOpacity }}>
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
    gap: 2,
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
